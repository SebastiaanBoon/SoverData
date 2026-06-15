"""Pipelines API — CRUD and execution of Python/SQL pipelines."""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from server.config import app_state
from server.workspace import manager as wm
from server.orchestrator.scheduler import run_pipeline

router = APIRouter()


class PipelineRequest(BaseModel):
    name: str
    type: str  # "python" or "sql"
    code: str


@router.get("")
def list_pipelines():
    ws = app_state.require_workspace()
    return wm.list_pipelines(ws)


@router.get("/{pipeline_type}/{name}")
def get_pipeline(name: str, pipeline_type: str):
    ws = app_state.require_workspace()
    try:
        return wm.get_pipeline(ws, name, pipeline_type)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {name}")


@router.post("")
def create_pipeline(req: PipelineRequest):
    ws = app_state.require_workspace()
    if req.type not in ("python", "sql"):
        raise HTTPException(status_code=400, detail="type must be 'python' or 'sql'")
    try:
        return wm.save_pipeline(ws, req.name, req.code, req.type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{pipeline_type}/{name}")
def update_pipeline(name: str, pipeline_type: str, req: PipelineRequest):
    ws = app_state.require_workspace()
    try:
        return wm.save_pipeline(ws, req.name, req.code, pipeline_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{pipeline_type}/{name}")
def delete_pipeline(name: str, pipeline_type: str):
    ws = app_state.require_workspace()
    try:
        wm.delete_pipeline(ws, name, pipeline_type)
        return {"status": "deleted"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Pipeline not found: {name}")


@router.post("/{pipeline_type}/{name}/run")
async def trigger_run(name: str, pipeline_type: str):
    ws = app_state.require_workspace()
    try:
        run_meta = await run_pipeline(ws, name, pipeline_type)
        return run_meta
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
