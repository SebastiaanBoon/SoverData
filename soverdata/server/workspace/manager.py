"""Workspace read/write — the open workspace format."""
from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

WORKSPACE_FORMAT_VERSION = "1.0"

WORKSPACE_DIRS = [
    "connections",
    "pipelines/python",
    "pipelines/sql",
    "lakehouse/bronze",
    "lakehouse/silver",
    "lakehouse/gold",
    "catalog",
    "runs",
]


# ---------------------------------------------------------------------------
# Workspace lifecycle
# ---------------------------------------------------------------------------

def create_workspace(path: str, name: str, description: str = "") -> dict:
    """Create a new workspace folder structure and workspace.yaml."""
    root = Path(path).resolve()
    root.mkdir(parents=True, exist_ok=True)

    for subdir in WORKSPACE_DIRS:
        (root / subdir).mkdir(parents=True, exist_ok=True)

    meta: dict[str, Any] = {
        "name": name,
        "description": description,
        "format_version": WORKSPACE_FORMAT_VERSION,
        "created_at": _now(),
    }
    _write_yaml(root / "workspace.yaml", meta)

    # Seed catalog/tables.yaml
    _write_yaml(root / "catalog" / "tables.yaml", {"tables": []})

    return {**meta, "path": str(root)}


def open_workspace(path: str) -> dict:
    """Validate and return workspace metadata."""
    root = Path(path).resolve()
    if not root.exists():
        raise ValueError(f"Path does not exist: {root}")
    cfg_file = root / "workspace.yaml"
    if not cfg_file.exists():
        raise ValueError(f"Not a valid workspace (missing workspace.yaml): {root}")
    meta = _read_yaml(cfg_file)
    return {**meta, "path": str(root)}


def workspace_info(root: Path) -> dict:
    cfg = _read_yaml(root / "workspace.yaml")
    return {**cfg, "path": str(root)}


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------

def list_connections(root: Path) -> list[dict]:
    folder = root / "connections"
    result = []
    for f in sorted(folder.glob("*.yaml")):
        data = _read_yaml(f)
        result.append(data)
    return result


def save_connection(root: Path, name: str, data: dict) -> dict:
    folder = root / "connections"
    folder.mkdir(exist_ok=True)
    data["name"] = name
    data.setdefault("created_at", _now())
    data["updated_at"] = _now()
    _write_yaml(folder / f"{name}.yaml", data)
    return data


def delete_connection(root: Path, name: str) -> None:
    f = root / "connections" / f"{name}.yaml"
    if not f.exists():
        raise FileNotFoundError(f"Connection not found: {name}")
    f.unlink()


def get_connection(root: Path, name: str) -> dict:
    f = root / "connections" / f"{name}.yaml"
    if not f.exists():
        raise FileNotFoundError(f"Connection not found: {name}")
    return _read_yaml(f)


# ---------------------------------------------------------------------------
# Pipelines
# ---------------------------------------------------------------------------

def list_pipelines(root: Path) -> list[dict]:
    result = []
    for py_file in sorted((root / "pipelines" / "python").glob("*.py")):
        result.append({
            "name": py_file.stem,
            "type": "python",
            "path": str(py_file.relative_to(root)),
            "size": py_file.stat().st_size,
            "modified": datetime.fromtimestamp(py_file.stat().st_mtime, tz=timezone.utc).isoformat(),
        })
    for sql_file in sorted((root / "pipelines" / "sql").glob("*.sql")):
        result.append({
            "name": sql_file.stem,
            "type": "sql",
            "path": str(sql_file.relative_to(root)),
            "size": sql_file.stat().st_size,
            "modified": datetime.fromtimestamp(sql_file.stat().st_mtime, tz=timezone.utc).isoformat(),
        })
    return result


def get_pipeline(root: Path, name: str, pipeline_type: str) -> dict:
    ext = ".py" if pipeline_type == "python" else ".sql"
    folder = "python" if pipeline_type == "python" else "sql"
    f = root / "pipelines" / folder / f"{name}{ext}"
    if not f.exists():
        raise FileNotFoundError(f"Pipeline not found: {name}")
    code = f.read_text(encoding="utf-8")
    return {
        "name": name,
        "type": pipeline_type,
        "code": code,
        "path": str(f.relative_to(root)),
    }


def save_pipeline(root: Path, name: str, code: str, pipeline_type: str) -> dict:
    ext = ".py" if pipeline_type == "python" else ".sql"
    folder = "python" if pipeline_type == "python" else "sql"
    target_dir = root / "pipelines" / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    f = target_dir / f"{name}{ext}"
    f.write_text(code, encoding="utf-8")
    return {"name": name, "type": pipeline_type, "path": str(f.relative_to(root))}


def delete_pipeline(root: Path, name: str, pipeline_type: str) -> None:
    ext = ".py" if pipeline_type == "python" else ".sql"
    folder = "python" if pipeline_type == "python" else "sql"
    f = root / "pipelines" / folder / f"{name}{ext}"
    if not f.exists():
        raise FileNotFoundError(f"Pipeline not found: {name}")
    f.unlink()


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

def get_catalog_tables(root: Path) -> list[dict]:
    tables_file = root / "catalog" / "tables.yaml"
    if not tables_file.exists():
        return []
    data = _read_yaml(tables_file)
    return data.get("tables", [])


def register_table(root: Path, table_meta: dict) -> None:
    tables_file = root / "catalog" / "tables.yaml"
    data = _read_yaml(tables_file) if tables_file.exists() else {"tables": []}
    tables = data.get("tables", [])
    # Update if exists, else append
    for i, t in enumerate(tables):
        if t.get("name") == table_meta["name"] and t.get("layer") == table_meta.get("layer"):
            tables[i] = table_meta
            break
    else:
        tables.append(table_meta)
    data["tables"] = tables
    _write_yaml(tables_file, data)


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

def list_runs(root: Path, pipeline: str | None = None) -> list[dict]:
    runs_dir = root / "runs"
    if not runs_dir.exists():
        return []
    result = []
    for run_dir in sorted(runs_dir.iterdir(), reverse=True):
        if run_dir.is_dir():
            run_yaml = run_dir / "run.yaml"
            if run_yaml.exists():
                data = _read_yaml(run_yaml)
                if pipeline is None or data.get("pipeline") == pipeline:
                    result.append(data)
    return result


def get_run(root: Path, run_id: str) -> dict:
    run_dir = root / "runs" / run_id
    if not run_dir.exists():
        raise FileNotFoundError(f"Run not found: {run_id}")
    data = _read_yaml(run_dir / "run.yaml")
    stdout_file = run_dir / "stdout.log"
    stderr_file = run_dir / "stderr.log"
    data["stdout"] = stdout_file.read_text(encoding="utf-8") if stdout_file.exists() else ""
    data["stderr"] = stderr_file.read_text(encoding="utf-8") if stderr_file.exists() else ""
    return data


def save_run(root: Path, run_meta: dict, stdout: str = "", stderr: str = "") -> None:
    run_id = run_meta["id"]
    run_dir = root / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_yaml(run_dir / "run.yaml", run_meta)
    (run_dir / "stdout.log").write_text(stdout, encoding="utf-8")
    (run_dir / "stderr.log").write_text(stderr, encoding="utf-8")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _write_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()
