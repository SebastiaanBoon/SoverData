"""Runs API — run history and logs."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from server.config import app_state
from server.workspace import manager as wm

router = APIRouter()


@router.get("")
def list_runs(pipeline: Optional[str] = Query(default=None)):
    ws = app_state.require_workspace()
    return wm.list_runs(ws, pipeline=pipeline)


@router.get("/{run_id}")
def get_run(run_id: str):
    ws = app_state.require_workspace()
    try:
        return wm.get_run(ws, run_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
