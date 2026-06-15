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
from server.engine import query as engine


def _run_id(pipeline_name: str) -> str:
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"{ts}_{pipeline_name}"


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
            stdout_buf, stderr_buf, exit_code = await _run_python(workspace_path, name)
        elif pipeline_type == "sql":
            stdout_buf, stderr_buf, exit_code = await _run_sql(workspace_path, name)
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
    return run_meta


async def _run_python(workspace_path: Path, name: str) -> tuple[str, str, int]:
    """Run a Python pipeline script as a subprocess."""
    script = workspace_path / "pipelines" / "python" / f"{name}.py"
    if not script.exists():
        raise FileNotFoundError(f"Python pipeline not found: {script}")

    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        str(script),
        cwd=str(workspace_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_pipeline_env(workspace_path),
    )
    stdout_bytes, stderr_bytes = await proc.communicate()
    return (
        stdout_bytes.decode("utf-8", errors="replace"),
        stderr_bytes.decode("utf-8", errors="replace"),
        proc.returncode or 0,
    )


async def _run_sql(workspace_path: Path, name: str) -> tuple[str, str, int]:
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
                f"lakehouse/{target_layer}/{target_table}/data.parquet\n"
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


def _pipeline_env(workspace_path: Path) -> dict:
    """Environment variables available to pipeline scripts."""
    import os
    env = os.environ.copy()
    env["SOVERDATA_WORKSPACE"] = str(workspace_path)
    env["SOVERDATA_LAKEHOUSE"] = str(workspace_path / "lakehouse")
    return env
