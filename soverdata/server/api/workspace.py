"""Workspace API — open and create workspaces."""
from __future__ import annotations

import os
import string
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import app_state
from server.workspace import manager as wm

router = APIRouter()


class OpenWorkspaceRequest(BaseModel):
    path: str


class CreateWorkspaceRequest(BaseModel):
    path: str
    name: str
    description: str = ""


@router.get("")
def get_workspace():
    if not app_state.is_open():
        return None
    try:
        return wm.workspace_info(app_state.get_workspace())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scan")
def scan_workspaces():
    """Scan common locations for workspace.yaml files and return found workspaces."""
    import os
    import yaml as _yaml

    found = []
    seen: set[str] = set()

    _SKIP = {
        "node_modules", ".git", "__pycache__", ".venv", "venv",
        "AppData", "site-packages", "$Recycle.Bin", "Windows",
    }

    def _walk(root: str):
        try:
            entries = os.scandir(root)
        except OSError:
            return
        dirs = []
        with entries:
            for e in entries:
                try:
                    if e.is_file(follow_symlinks=False) and e.name == "workspace.yaml":
                        ws_dir = root
                        if ws_dir not in seen:
                            seen.add(ws_dir)
                            try:
                                with open(e.path, encoding="utf-8") as f:
                                    cfg = _yaml.safe_load(f) or {}
                                found.append({
                                    "path": ws_dir,
                                    "name": cfg.get("name") or Path(ws_dir).name,
                                    "description": cfg.get("description", ""),
                                })
                            except Exception:
                                found.append({"path": ws_dir, "name": Path(ws_dir).name, "description": ""})
                    elif e.is_dir(follow_symlinks=False) and e.name not in _SKIP:
                        dirs.append(e.path)
                except OSError:
                    continue
        for d in dirs:
            _walk(d)

    _walk(str(Path.home()))
    return {"workspaces": found}


@router.get("/browse")
def browse_folders(path: str | None = None):
    """Browse local folders so users can choose a workspace path."""
    try:
        target = _resolve_browser_path(path)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {target}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a folder: {target}")

    entries = []
    error = None
    try:
        children = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        for child in children:
            try:
                if not child.is_dir():
                    continue
                stat = child.stat()
                entries.append(
                    {
                        "name": child.name or str(child),
                        "path": str(child),
                        "type": "folder",
                        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                        "is_workspace": (child / "workspace.yaml").is_file(),
                    }
                )
            except OSError:
                continue
    except OSError as exc:
        error = str(exc)

    parent = None if target.parent == target else str(target.parent)
    return {
        "path": str(target),
        "parent": parent,
        "roots": _browser_roots(),
        "entries": entries,
        "is_workspace": (target / "workspace.yaml").is_file(),
        "error": error,
    }


@router.post("/open")
def open_workspace(req: OpenWorkspaceRequest):
    try:
        info = wm.open_workspace(req.path)
        app_state.set_workspace(req.path)
        return info
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create")
def create_workspace(req: CreateWorkspaceRequest):
    try:
        info = wm.create_workspace(req.path, req.name, req.description)
        app_state.set_workspace(req.path)
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/close")
def close_workspace():
    app_state.workspace_path = None
    return {"status": "closed"}


def _resolve_browser_path(path: str | None) -> Path:
    if path:
        return Path(path).expanduser().resolve()
    home = Path.home()
    if home.exists():
        return home.resolve()
    return Path.cwd().resolve()


def _browser_roots() -> list[dict]:
    roots: list[dict] = []
    home = Path.home()
    if home.exists():
        roots.append({"label": "Home", "path": str(home.resolve())})

    if os.name == "nt":
        for letter in string.ascii_uppercase:
            drive = Path(f"{letter}:\\")
            if drive.exists():
                roots.append({"label": f"{letter}:", "path": str(drive)})
    else:
        roots.append({"label": "/", "path": "/"})

    seen: set[str] = set()
    unique = []
    for root in roots:
        if root["path"] in seen:
            continue
        seen.add(root["path"])
        unique.append(root)
    return unique
