"""Workspace API."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import app_state
from server.workspace import manager as wm

router = APIRouter()


class CreateWorkspaceRequest(BaseModel):
    name: str
    description: str = ""


class OpenWorkspaceRequest(BaseModel):
    path: str


@router.get("/root")
def get_workspaces_root():
    """Return the managed workspaces root folder."""
    root = app_state.workspaces_root
    root.mkdir(parents=True, exist_ok=True)
    return {"path": str(root)}


@router.get("/list")
def list_workspaces():
    """List all workspaces inside the managed workspaces root."""
    root = app_state.workspaces_root
    root.mkdir(parents=True, exist_ok=True)
    workspaces = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        yaml_file = child / "workspace.yaml"
        if not yaml_file.exists():
            continue
        try:
            import yaml
            with open(yaml_file, encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            workspaces.append({
                "path": str(child),
                "name": cfg.get("name") or child.name,
                "description": cfg.get("description", ""),
                "created_at": cfg.get("created_at"),
            })
        except Exception:
            workspaces.append({"path": str(child), "name": child.name, "description": "", "created_at": None})
    return {"workspaces": workspaces, "root": str(root)}


@router.get("")
def get_workspace():
    if not app_state.is_open():
        return None
    try:
        return wm.workspace_info(app_state.get_workspace())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    root = app_state.workspaces_root
    root.mkdir(parents=True, exist_ok=True)
    folder_name = _slugify(req.name) or "workspace"
    path = root / folder_name
    suffix = 2
    while path.exists():
        path = root / f"{folder_name}-{suffix}"
        suffix += 1
    try:
        info = wm.create_workspace(str(path), req.name, req.description)
        app_state.set_workspace(str(path))
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/close")
def close_workspace():
    app_state.workspace_path = None
    return {"status": "closed"}


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:64]
