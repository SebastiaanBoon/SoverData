"""In-process pipeline runner with run history."""
from __future__ import annotations

import asyncio
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server.workspace import manager as wm
from server.workspace import dependencies as deps
from server.engine import query as engine
from server.engine import lakehouse

_active_orchestrations: set[str] = set()


def _run_id(pipeline_name: str) -> str:
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    return f"{ts}_{pipeline_name}"


async def run_due_triggers(workspace_path: Path) -> int:
    """Check saved orchestrations and fire any enabled triggers that are due."""
    fired = 0
    now = datetime.now().astimezone()
    for orchestration in wm.list_orchestrations(workspace_path):
        name = orchestration.get("name")
        if not name or name in _active_orchestrations:
            continue
        for trigger in orchestration.get("triggers", []):
            if not trigger.get("enabled", True):
                continue
            trigger_type = trigger.get("type")
            if trigger_type not in ("interval", "daily"):
                continue
            if not _is_trigger_due(trigger, now):
                continue

            trigger_id = trigger.get("id")
            if not trigger_id:
                continue

            wm.record_orchestration_trigger_fire(workspace_path, name, trigger_id, fired_at=now.isoformat())
            _active_orchestrations.add(name)
            asyncio.create_task(_run_triggered_orchestration(workspace_path, name))
            fired += 1
            break
    return fired


async def _run_triggered_orchestration(workspace_path: Path, name: str) -> None:
    try:
        await run_orchestration(workspace_path, name)
    except Exception:
        pass
    finally:
        _active_orchestrations.discard(name)


def _is_trigger_due(trigger: dict, now: datetime) -> bool:
    trigger_type = trigger.get("type")
    if trigger_type == "interval":
        every_minutes = int(trigger.get("every_minutes") or 0)
        if every_minutes <= 0:
            return False
        last_fired_at = _parse_dt(trigger.get("last_fired_at"))
        if last_fired_at is None:
            return True
        return (now - last_fired_at).total_seconds() >= every_minutes * 60

    if trigger_type == "daily":
        at_time = trigger.get("at_time")
        if not isinstance(at_time, str) or not at_time:
            return False
        try:
            hour, minute = [int(part) for part in at_time.split(":", 1)]
        except Exception:
            return False
        last_fired_at = _parse_dt(trigger.get("last_fired_at"))
        if last_fired_at and last_fired_at.date() >= now.date():
            return False
        scheduled = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return now >= scheduled

    return False


def _parse_dt(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


async def run_pipeline(
    workspace_path: Path,
    name: str,
    pipeline_type: str,
) -> dict:
    """Execute a pipeline and record the run. Returns the run metadata."""
    run_id = _run_id(name)
    started = datetime.now(tz=timezone.utc)

    run_meta: dict[str, Any] = {
        "id": run_id,
        "pipeline": name,
        "type": pipeline_type,
        "status": "running",
        "started_at": started.isoformat(),
        "finished_at": None,
        "duration_seconds": None,
        "exit_code": None,
    }
    wm.save_run(workspace_path, run_meta)

    stdout_buf = ""
    stderr_buf = ""
    exit_code = 0

    try:
        if pipeline_type == "python":
            stdout_buf, stderr_buf, exit_code = await _run_python(workspace_path, name, run_id)
        elif pipeline_type == "sql":
            stdout_buf, stderr_buf, exit_code = await _run_sql(workspace_path, name, run_id)
        else:
            raise ValueError(f"Unknown pipeline type: {pipeline_type}")

        status = "success" if exit_code == 0 else "failed"
    except Exception as exc:
        stderr_buf += f"\n[ERROR] {exc}"
        status = "failed"
        exit_code = 1

    finished = datetime.now(tz=timezone.utc)
    duration = (finished - started).total_seconds()

    run_meta.update(
        status=status,
        finished_at=finished.isoformat(),
        duration_seconds=round(duration, 2),
        exit_code=exit_code,
    )
    wm.save_run(workspace_path, run_meta, stdout=stdout_buf, stderr=stderr_buf)
    try:
        lakehouse.cleanup_bronze_retention(workspace_path)
    except Exception:
        pass
    return run_meta


async def _run_python(workspace_path: Path, name: str, run_id: str) -> tuple[str, str, int]:
    """Run a Python pipeline script as a subprocess."""
    script = workspace_path / "pipelines" / "python" / f"{name}.py"
    if not script.exists():
        raise FileNotFoundError(f"Python pipeline not found: {script}")

    install_info = await deps.ensure_requirements_installed(workspace_path)
    install_stdout, install_stderr = _format_dependency_install_logs(install_info)
    if install_info["status"] == "failed":
        return install_stdout, install_stderr, 1

    bronze_backups = lakehouse.prepare_bronze_run(workspace_path, run_id)
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        str(script),
        cwd=str(workspace_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_pipeline_env(workspace_path, run_id),
    )
    stdout_bytes, stderr_bytes = await proc.communicate()
    exit_code = proc.returncode or 0
    lakehouse.finalize_bronze_run(workspace_path, run_id, bronze_backups, success=exit_code == 0)
    return (
        install_stdout + stdout_bytes.decode("utf-8", errors="replace"),
        install_stderr + stderr_bytes.decode("utf-8", errors="replace"),
        exit_code,
    )


async def _run_sql(workspace_path: Path, name: str, run_id: str) -> tuple[str, str, int]:
    """Run a SQL pipeline via DuckDB.

    If the SQL file contains a directive ``-- target: <layer>.<table>`` (anywhere
    in the file, including as the first non-blank line), the query result is written
    as Parquet to ``lakehouse/<layer>/<table>/`` and registered in the catalog.
    Without the directive the query is executed and the result is logged.
    """
    sql_file = workspace_path / "pipelines" / "sql" / f"{name}.sql"
    if not sql_file.exists():
        raise FileNotFoundError(f"SQL pipeline not found: {sql_file}")

    sql_text = sql_file.read_text(encoding="utf-8")

    # Parse optional target directive: -- target: silver.sales_summary
    target_layer, target_table = _parse_target(sql_text)

    try:
        import duckdb, re
        # Strip comment lines so DuckDB can execute cleanly
        clean_sql = sql_text

        if target_layer and target_table:
            out_path = workspace_path / "lakehouse" / target_layer / target_table
            out_path.mkdir(parents=True, exist_ok=True)
            if target_layer == "bronze":
                parquet_out = out_path / f"part-{_safe_run_id(run_id)}.parquet"
            else:
                parquet_out = out_path / "data.parquet"

            # Use DuckDB to execute and write to Parquet
            conn = duckdb.connect(":memory:")
            try:
                # Register lakehouse views
                from server.engine.query import _register_lakehouse
                _register_lakehouse(conn, workspace_path)

                # Wrap query in COPY TO ... (PARQUET)
                inner = clean_sql.strip().rstrip(";")
                conn.execute(
                    f"COPY ({inner}) TO '{parquet_out.as_posix()}' (FORMAT PARQUET)"
                )
                row_count = conn.execute(f"SELECT COUNT(*) FROM '{parquet_out.as_posix()}'").fetchone()[0]
            finally:
                conn.close()

            # Register in catalog
            from server.workspace import manager as wm
            wm.register_table(workspace_path, {
                "name": target_table,
                "layer": target_layer,
                "path": f"lakehouse/{target_layer}/{target_table}",
                "format": "parquet",
                "description": f"Created by SQL pipeline: {name}",
                "lineage": {"pipeline": f"pipelines/sql/{name}.sql"},
            })
            stdout = (
                f"Written {row_count} rows to "
                f"{parquet_out.relative_to(workspace_path).as_posix()}\n"
                f"Table registered in catalog as {target_layer}__{target_table}\n"
            )
            return stdout, "", 0
        else:
            result = engine.execute_sql(sql_text, workspace_path)
            stdout = f"Query executed. Rows returned: {result.get('row_count', 0)}\n"
            return stdout, "", 0
    except Exception as exc:
        return "", str(exc), 1


def _parse_target(sql: str) -> tuple[str | None, str | None]:
    """Parse ``-- target: layer.table`` directive from SQL text."""
    import re
    m = re.search(r"--\s*target\s*:\s*(\w+)\.(\w+)", sql, re.IGNORECASE)
    if m:
        return m.group(1).lower(), m.group(2).lower()
    return None, None


def _pipeline_env(workspace_path: Path, run_id: str) -> dict:
    """Environment variables available to pipeline scripts."""
    import os
    env = os.environ.copy()
    env["SOVERDATA_WORKSPACE"] = str(workspace_path)
    env["SOVERDATA_LAKEHOUSE"] = str(workspace_path / "lakehouse")
    env["SOVERDATA_RUN_ID"] = run_id
    env = deps.add_packages_to_env(workspace_path, env)

    app_root = Path(__file__).resolve().parents[2]
    python_paths = []
    if env.get("PYTHONPATH"):
        python_paths.append(env["PYTHONPATH"])
    python_paths.append(str(app_root))
    env["PYTHONPATH"] = os.pathsep.join(python_paths)
    return env


def _format_dependency_install_logs(info: dict) -> tuple[str, str]:
    if not info.get("installed_now"):
        return "", ""

    stdout = "[SoverData] Installing workspace Python packages from requirements.txt\n"
    if info.get("stdout"):
        stdout += info["stdout"]
        if not stdout.endswith("\n"):
            stdout += "\n"

    stderr = ""
    if info.get("stderr"):
        stderr = info["stderr"]
        if not stderr.endswith("\n"):
            stderr += "\n"
    if info.get("status") == "failed":
        stderr += (
            "[SoverData] Package installation failed. Update requirements.txt "
            "from the Packages page and run the pipeline again.\n"
        )
    return stdout, stderr


def _safe_run_id(run_id: str) -> str:
    import re
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", run_id)
