"""Packages API - workspace Python dependency management."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import app_state
from server.workspace import dependencies as deps

router = APIRouter()


class RequirementsRequest(BaseModel):
    requirements: str


class InstallRequest(BaseModel):
    force: bool = False


@router.get("")
def get_packages():
    ws = app_state.require_workspace()
    try:
        return deps.get_dependency_info(ws)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/requirements")
def update_requirements(req: RequirementsRequest):
    ws = app_state.require_workspace()
    try:
        return deps.save_requirements(ws, req.requirements)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/install")
async def install_packages(req: InstallRequest | None = None):
    ws = app_state.require_workspace()
    try:
        return await deps.install_requirements(ws, force=req.force if req else False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
