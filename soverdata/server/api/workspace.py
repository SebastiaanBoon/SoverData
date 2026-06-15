"""Workspace API — open and create workspaces."""
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
