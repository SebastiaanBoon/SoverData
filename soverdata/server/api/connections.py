"""Connections API — CRUD for data source connections."""
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import app_state
from server.workspace import manager as wm

router = APIRouter()


class ConnectionRequest(BaseModel):
    name: str
    type: str
    description: str = ""
    config: dict[str, Any] = {}


@router.get("")
def list_connections():
    ws = app_state.require_workspace()
    return wm.list_connections(ws)


@router.post("")
def create_connection(req: ConnectionRequest):
    ws = app_state.require_workspace()
    try:
        data = {
            "name": req.name,
            "type": req.type,
            "description": req.description,
            "config": req.config,
        }
        return wm.save_connection(ws, req.name, data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}")
def get_connection(name: str):
    ws = app_state.require_workspace()
    try:
        return wm.get_connection(ws, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Connection not found: {name}")


@router.put("/{name}")
def update_connection(name: str, req: ConnectionRequest):
    ws = app_state.require_workspace()
    try:
        existing = wm.get_connection(ws, name)
        existing.update({
            "name": req.name,
            "type": req.type,
            "description": req.description,
            "config": req.config,
        })
        return wm.save_connection(ws, req.name, existing)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Connection not found: {name}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{name}")
def delete_connection(name: str):
    ws = app_state.require_workspace()
    try:
        wm.delete_connection(ws, name)
        return {"status": "deleted"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Connection not found: {name}")


@router.post("/{name}/test")
def test_connection(name: str):
    ws = app_state.require_workspace()
    try:
        conn = wm.get_connection(ws, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Connection not found: {name}")

    conn_type = conn.get("type", "")
    config = conn.get("config", {})

    if conn_type in ("csv", "parquet", "delta"):
        path = config.get("path", "")
        from pathlib import Path
        target = Path(path) if Path(path).is_absolute() else ws / path
        if target.exists():
            return {"status": "ok", "message": f"File/folder exists: {target}"}
        return {"status": "error", "message": f"Path not found: {target}"}

    if conn_type == "duckdb":
        try:
            import duckdb
            db_path = config.get("path", ":memory:")
            c = duckdb.connect(db_path)
            c.close()
            return {"status": "ok", "message": "DuckDB connection successful"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    if conn_type in ("postgres", "mysql", "mssql"):
        try:
            import sqlalchemy
            url = config.get("connection_string", "")
            engine = sqlalchemy.create_engine(url)
            with engine.connect() as c:
                c.execute(sqlalchemy.text("SELECT 1"))
            return {"status": "ok", "message": "Database connection successful"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return {"status": "unknown", "message": f"Test not implemented for type: {conn_type}"}
