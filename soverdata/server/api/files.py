"""Files API - browse and preview files inside the open workspace."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from server.config import app_state

router = APIRouter()

MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
TEXT_EXTENSIONS = {
    ".cfg",
    ".csv",
    ".env",
    ".ini",
    ".json",
    ".log",
    ".md",
    ".py",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}


@router.get("")
def list_files(path: str = Query(default="")):
    workspace = app_state.require_workspace()
    target = _resolve_workspace_path(workspace, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Path not found.")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a folder.")

    entries = []
    for item in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        stat = item.stat()
        entries.append({
            "name": item.name,
            "path": _relative_path(workspace, item),
            "type": "folder" if item.is_dir() else "file",
            "size": None if item.is_dir() else stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "extension": "" if item.is_dir() else item.suffix.lower(),
            "previewable": item.is_file() and _is_text_previewable(item),
        })

    parent = None if target == workspace else _relative_path(workspace, target.parent)
    return {
        "path": _relative_path(workspace, target),
        "parent": parent,
        "entries": entries,
    }


@router.get("/content")
def get_file_content(path: str):
    workspace = app_state.require_workspace()
    target = _resolve_workspace_path(workspace, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file.")
    if not _is_text_previewable(target):
        raise HTTPException(status_code=400, detail="File is not previewable as text.")

    return {
        "path": _relative_path(workspace, target),
        "name": target.name,
        "size": target.stat().st_size,
        "content": target.read_text(encoding="utf-8", errors="replace"),
    }


@router.get("/download")
def download_file(path: str):
    workspace = app_state.require_workspace()
    target = _resolve_workspace_path(workspace, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file.")
    return FileResponse(str(target), filename=target.name)


def _resolve_workspace_path(workspace: Path, relative_path: str) -> Path:
    root = workspace.resolve()
    target = (root / relative_path).resolve() if relative_path else root
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path must stay inside the open workspace.")
    return target


def _relative_path(workspace: Path, target: Path) -> str:
    rel = target.resolve().relative_to(workspace.resolve())
    return "" if str(rel) == "." else rel.as_posix()


def _is_text_previewable(path: Path) -> bool:
    if path.stat().st_size > MAX_TEXT_PREVIEW_BYTES:
        return False
    return path.suffix.lower() in TEXT_EXTENSIONS or path.name.lower() in {".gitignore", "requirements.txt"}
