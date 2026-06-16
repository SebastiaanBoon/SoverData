"""Lakehouse write helpers and Bronze retention."""
from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

DEFAULT_RETENTION = {
    "enabled": False,
    "bronze_days": 90,
    "cleanup_interval_hours": 24,
    "last_cleanup_at": None,
}


def write_table(
    df: Any,
    lakehouse: str | Path,
    layer: str,
    table: str,
    mode: str = "auto",
    run_id: str | None = None,
) -> Path:
    """Write a DataFrame to the lakehouse.

    Bronze defaults to append-only run files. Silver and Gold default to the
    current table snapshot at data.parquet.
    """
    layer = layer.lower()
    if layer not in {"bronze", "silver", "gold"}:
        raise ValueError("layer must be bronze, silver, or gold")

    out_dir = Path(lakehouse) / layer / table
    out_dir.mkdir(parents=True, exist_ok=True)

    effective_mode = "append" if mode == "auto" and layer == "bronze" else mode
    effective_mode = "overwrite" if effective_mode == "auto" else effective_mode

    if effective_mode == "append":
        rid = _safe_name(run_id or os.environ.get("SOVERDATA_RUN_ID") or _timestamp())
        out_file = out_dir / f"part-{rid}.parquet"
    elif effective_mode == "overwrite":
        out_file = out_dir / "data.parquet"
    else:
        raise ValueError("mode must be auto, append, or overwrite")

    df.to_parquet(out_file, index=False)
    return out_file


def prepare_bronze_run(workspace_path: Path, run_id: str) -> list[dict[str, str]]:
    """Copy current Bronze data.parquet files outside the lakehouse before a run."""
    backups: list[dict[str, str]] = []
    backup_root = workspace_path / ".soverdata" / "bronze-backups" / _safe_name(run_id)
    bronze_root = workspace_path / "lakehouse" / "bronze"
    if not bronze_root.exists():
        return backups

    for data_file in bronze_root.glob("*/data.parquet"):
        table_dir = data_file.parent
        backup_dir = backup_root / table_dir.name
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_file = backup_dir / "data.parquet"
        shutil.copy2(data_file, backup_file)
        backups.append({
            "table": table_dir.name,
            "source": str(data_file),
            "backup": str(backup_file),
            "mtime": str(int(data_file.stat().st_mtime)),
        })
    return backups


def finalize_bronze_run(
    workspace_path: Path,
    run_id: str,
    backups: list[dict[str, str]],
    success: bool,
) -> None:
    """Convert legacy Bronze data.parquet writes into append-only run files."""
    bronze_root = workspace_path / "lakehouse" / "bronze"
    if not bronze_root.exists():
        return

    if not success:
        for backup in backups:
            backup_file = Path(backup["backup"])
            source_file = Path(backup["source"])
            if backup_file.exists():
                source_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup_file, source_file)
        return

    for backup in backups:
        backup_file = Path(backup["backup"])
        source_file = Path(backup["source"])
        if not backup_file.exists():
            continue
        legacy_name = f"part-legacy-{backup['mtime']}.parquet"
        legacy_file = source_file.parent / legacy_name
        if not legacy_file.exists():
            shutil.copy2(backup_file, legacy_file)

    safe_run_id = _safe_name(run_id)
    for data_file in bronze_root.glob("*/data.parquet"):
        table_dir = data_file.parent
        out_file = table_dir / f"part-{safe_run_id}.parquet"
        if out_file.exists():
            out_file = table_dir / f"part-{safe_run_id}-{_timestamp()}.parquet"
        shutil.move(str(data_file), str(out_file))


def get_retention_settings(workspace_path: Path) -> dict[str, Any]:
    cfg = _read_workspace_yaml(workspace_path)
    configured = cfg.get("lakehouse_retention") or {}
    return {**DEFAULT_RETENTION, **configured}


def save_retention_settings(workspace_path: Path, settings: dict[str, Any]) -> dict[str, Any]:
    cfg = _read_workspace_yaml(workspace_path)
    current = get_retention_settings(workspace_path)
    updated = {
        **current,
        "enabled": bool(settings.get("enabled", current["enabled"])),
        "bronze_days": max(1, int(settings.get("bronze_days", current["bronze_days"]))),
        "cleanup_interval_hours": max(1, int(settings.get("cleanup_interval_hours", current["cleanup_interval_hours"]))),
    }
    cfg["lakehouse_retention"] = updated
    _write_workspace_yaml(workspace_path, cfg)
    return updated


def cleanup_bronze_retention(workspace_path: Path, force: bool = False) -> dict[str, Any]:
    settings = get_retention_settings(workspace_path)
    now = datetime.now(tz=timezone.utc)
    if not settings["enabled"] and not force:
        return {"status": "disabled", "deleted_files": 0, "settings": settings}

    last_cleanup_at = settings.get("last_cleanup_at")
    if last_cleanup_at and not force:
        try:
            last = datetime.fromisoformat(last_cleanup_at)
            due_at = last + timedelta(hours=int(settings["cleanup_interval_hours"]))
            if now < due_at:
                return {"status": "not_due", "deleted_files": 0, "settings": settings}
        except ValueError:
            pass

    cutoff = now - timedelta(days=int(settings["bronze_days"]))
    deleted = 0
    bronze_root = workspace_path / "lakehouse" / "bronze"
    if bronze_root.exists():
        for file in bronze_root.glob("*/part-*.parquet"):
            mtime = datetime.fromtimestamp(file.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                file.unlink()
                deleted += 1

    settings["last_cleanup_at"] = now.isoformat()
    cfg = _read_workspace_yaml(workspace_path)
    cfg["lakehouse_retention"] = settings
    _write_workspace_yaml(workspace_path, cfg)
    return {"status": "ok", "deleted_files": deleted, "settings": settings}


def _read_workspace_yaml(workspace_path: Path) -> dict:
    path = workspace_path / "workspace.yaml"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _write_workspace_yaml(workspace_path: Path, data: dict) -> None:
    path = workspace_path / "workspace.yaml"
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)


def _timestamp() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
