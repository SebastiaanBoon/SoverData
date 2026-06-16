"""Lakehouse API - retention and maintenance."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import app_state
from server.engine import lakehouse

router = APIRouter()


class RetentionRequest(BaseModel):
    enabled: bool
    bronze_days: int
    cleanup_interval_hours: int


@router.get("/retention")
def get_retention():
    ws = app_state.require_workspace()
    return lakehouse.get_retention_settings(ws)


@router.put("/retention")
def update_retention(req: RetentionRequest):
    ws = app_state.require_workspace()
    try:
        return lakehouse.save_retention_settings(ws, req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/retention/cleanup")
def cleanup_retention():
    ws = app_state.require_workspace()
    try:
        return lakehouse.cleanup_bronze_retention(ws, force=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
