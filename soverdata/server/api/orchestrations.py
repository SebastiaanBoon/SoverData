"""Orchestrations API - ordered pipeline execution."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.config import app_state
from server.orchestrator.orchestrations import run_orchestration
from server.workspace import manager as wm

router = APIRouter()


class OrchestrationStep(BaseModel):
    name: str
    type: Literal["python", "sql"]


class OrchestrationTrigger(BaseModel):
    id: str | None = None
    type: Literal["interval", "daily"]
    enabled: bool = True
    every_minutes: int | None = None
    at_time: str | None = None


class OrchestrationRequest(BaseModel):
    name: str
    description: str = ""
    steps: list[OrchestrationStep]
    triggers: list[OrchestrationTrigger] = Field(default_factory=list)


@router.get("")
def list_orchestrations():
    ws = app_state.require_workspace()
    return wm.list_orchestrations(ws)


@router.get("/runs")
def list_runs(orchestration: str | None = None):
    ws = app_state.require_workspace()
    return wm.list_orchestration_runs(ws, orchestration=orchestration)


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    ws = app_state.require_workspace()
    try:
        return wm.get_orchestration_run(ws, run_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Orchestration run not found: {run_id}")


@router.get("/{name}")
def get_orchestration(name: str):
    ws = app_state.require_workspace()
    try:
        return wm.get_orchestration(ws, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Orchestration not found: {name}")


@router.post("")
def create_orchestration(req: OrchestrationRequest):
    ws = app_state.require_workspace()
    try:
        return wm.save_orchestration(ws, req.name, req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{name}")
def update_orchestration(name: str, req: OrchestrationRequest):
    ws = app_state.require_workspace()
    try:
        return wm.save_orchestration(ws, name, req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{name}")
def delete_orchestration(name: str):
    ws = app_state.require_workspace()
    try:
        wm.delete_orchestration(ws, name)
        return {"status": "deleted"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Orchestration not found: {name}")


@router.post("/{name}/run")
async def trigger_run(name: str):
    ws = app_state.require_workspace()
    try:
        return await run_orchestration(ws, name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
