"""Workspace read/write — the open workspace format."""
from __future__ import annotations

import os
import shutil
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

WORKSPACE_FORMAT_VERSION = "1.0"

WORKSPACE_DIRS = [
    "connections",
    "pipelines/python",
    "pipelines/sql",
    "orchestrations",
    "lakehouse/bronze",
    "lakehouse/silver",
    "lakehouse/gold",
    "catalog",
    "runs",
    "orchestration-runs",
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
        "lakehouse_retention": {
            "enabled": False,
            "bronze_days": 90,
            "cleanup_interval_hours": 24,
            "last_cleanup_at": None,
        },
    }
    _write_yaml(root / "workspace.yaml", meta)

    # Seed catalog/tables.yaml
    _write_yaml(root / "catalog" / "tables.yaml", {"tables": []})
    _ensure_gitignore_entry(root / ".gitignore", ".soverdata/")

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
# Orchestrations
# ---------------------------------------------------------------------------

def list_orchestrations(root: Path) -> list[dict]:
    folder = root / "orchestrations"
    folder.mkdir(exist_ok=True)
    trigger_state = _read_orchestration_trigger_state(root)
    result = []
    for f in sorted(folder.glob("*.yaml")):
        if f.name.startswith("."):
            continue
        data = _read_yaml(f)
        data.setdefault("name", f.stem)
        data["path"] = str(f.relative_to(root))
        data["modified"] = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat()
        data["triggers"] = _merge_trigger_state(data.get("triggers", []), trigger_state.get("triggers", {}).get(data["name"], {}))
        data = _upgrade_orchestration(data)
        result.append(data)
    return result


def get_orchestration(root: Path, name: str) -> dict:
    f = root / "orchestrations" / f"{name}.yaml"
    if not f.exists():
        raise FileNotFoundError(f"Orchestration not found: {name}")
    data = _read_yaml(f)
    data.setdefault("name", name)
    data["path"] = str(f.relative_to(root))
    trigger_state = _read_orchestration_trigger_state(root)
    data["triggers"] = _merge_trigger_state(data.get("triggers", []), trigger_state.get("triggers", {}).get(data["name"], {}))
    return _upgrade_orchestration(data)


def save_orchestration(root: Path, name: str, data: dict) -> dict:
    folder = root / "orchestrations"
    folder.mkdir(exist_ok=True)
    triggers = _normalize_triggers(data.get("triggers", []))
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    saved = {
        "name": name,
        "description": data.get("description", ""),
        "retries": int(data.get("retries", 2) or 0),
        "nodes": nodes,
        "edges": edges,
        "steps": [] if nodes else data.get("steps", []),
        "triggers": triggers,
        "updated_at": _now(),
    }
    saved.setdefault("created_at", _now())
    existing = folder / f"{name}.yaml"
    if existing.exists():
        current = _read_yaml(existing)
        saved["created_at"] = current.get("created_at", saved["updated_at"])
    _write_yaml(existing, saved)
    return {**saved, "path": str(existing.relative_to(root))}


def delete_orchestration(root: Path, name: str) -> None:
    f = root / "orchestrations" / f"{name}.yaml"
    if not f.exists():
        raise FileNotFoundError(f"Orchestration not found: {name}")
    f.unlink()


def list_orchestration_runs(root: Path, orchestration: str | None = None) -> list[dict]:
    runs_dir = root / "orchestration-runs"
    if not runs_dir.exists():
        return []
    result = []
    for run_dir in sorted(runs_dir.iterdir(), reverse=True):
        if run_dir.is_dir():
            run_yaml = run_dir / "run.yaml"
            if run_yaml.exists():
                data = _read_yaml(run_yaml)
                if orchestration is None or data.get("orchestration") == orchestration:
                    result.append(data)
    return result


def get_orchestration_run(root: Path, run_id: str) -> dict:
    run_dir = root / "orchestration-runs" / run_id
    if not run_dir.exists():
        raise FileNotFoundError(f"Orchestration run not found: {run_id}")
    return _read_yaml(run_dir / "run.yaml")


def save_orchestration_run(root: Path, run_meta: dict) -> None:
    run_id = run_meta["id"]
    run_dir = root / "orchestration-runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_yaml(run_dir / "run.yaml", run_meta)


def record_orchestration_trigger_fire(root: Path, orchestration_name: str, trigger_id: str, fired_at: str | None = None) -> None:
    state = _read_orchestration_trigger_state(root)
    state.setdefault("triggers", {})
    orchestration_state = state["triggers"].setdefault(orchestration_name, {})
    orchestration_state[trigger_id] = {
        "last_fired_at": fired_at or _now(),
    }
    _write_orchestration_trigger_state(root, state)


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


def _ensure_gitignore_entry(path: Path, entry: str) -> None:
    if path.exists():
        text = path.read_text(encoding="utf-8")
        entries = {line.strip() for line in text.splitlines()}
        if entry in entries or entry.rstrip("/") in entries:
            return
        suffix = "" if text.endswith("\n") or not text else "\n"
        path.write_text(f"{text}{suffix}{entry}\n", encoding="utf-8")
    else:
        path.write_text(f"{entry}\n", encoding="utf-8")


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _trigger_state_path(root: Path) -> Path:
    return root / "orchestrations" / ".trigger-state.yaml"


def _read_orchestration_trigger_state(root: Path) -> dict:
    path = _trigger_state_path(root)
    if not path.exists():
        return {"triggers": {}}
    data = _read_yaml(path)
    data.setdefault("triggers", {})
    return data


def _write_orchestration_trigger_state(root: Path, data: dict) -> None:
    _write_yaml(_trigger_state_path(root), data)


def _normalize_triggers(triggers: list[dict]) -> list[dict]:
    normalized = []
    for trigger in triggers or []:
        item = deepcopy(trigger)
        item.setdefault("id", str(uuid4()))
        item.setdefault("enabled", True)
        item.setdefault("type", "interval")
        normalized.append(item)
    return normalized


def _upgrade_orchestration(data: dict) -> dict:
    """Convert legacy steps list to DAG nodes/edges if needed."""
    if data.get("nodes") or not data.get("steps"):
        data.setdefault("nodes", [])
        data.setdefault("edges", [])
        return data
    nodes = []
    edges = []
    prev_id = None
    for i, step in enumerate(data["steps"]):
        node_id = f"step_{i}"
        nodes.append({"id": node_id, "name": step.get("name"), "type": step.get("type"),
                      "x": i * 280 + 80, "y": 150})
        if prev_id:
            edges.append({"id": f"{prev_id}__{node_id}", "source": prev_id, "target": node_id})
        prev_id = node_id
    data["nodes"] = nodes
    data["edges"] = edges
    return data


def _merge_trigger_state(triggers: list[dict], state: dict) -> list[dict]:
    merged = []
    for trigger in triggers or []:
        item = deepcopy(trigger)
        trigger_id = item.get("id")
        if trigger_id and trigger_id in state:
            item.update(state[trigger_id])
        merged.append(item)
    return merged
