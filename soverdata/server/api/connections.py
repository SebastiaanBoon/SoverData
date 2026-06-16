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


class ConnectionQueryRequest(BaseModel):
    sql: str
    limit: int = 200


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


@router.post("/{name}/query")
def query_connection(name: str, req: ConnectionQueryRequest):
    """Run a SQL query against a saved connection and return preview rows."""
    ws = app_state.require_workspace()
    try:
        conn = wm.get_connection(ws, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Connection not found: {name}")

    conn_type = conn.get("type", "")
    config = conn.get("config", {})
    sql = req.sql.strip()
    limit = max(1, min(req.limit, 5000))

    try:
        if conn_type in ("postgres", "mysql", "mssql"):
            import sqlalchemy
            url = config.get("connection_string", "")
            engine = sqlalchemy.create_engine(url)
            with engine.connect() as c:
                result = c.execute(sqlalchemy.text(sql))
                columns = list(result.keys())
                rows = [list(r) for r in result.fetchmany(limit)]
            return {"columns": columns, "rows": rows, "row_count": len(rows)}

        if conn_type == "duckdb":
            import duckdb as _ddb
            db_path = config.get("path", ":memory:")
            c = _ddb.connect(db_path)
            try:
                res = c.execute(sql)
                columns = [d[0] for d in res.description]
                rows = [list(r) for r in res.fetchmany(limit)]
            finally:
                c.close()
            return {"columns": columns, "rows": rows, "row_count": len(rows)}

        if conn_type in ("csv", "parquet", "delta"):
            import duckdb as _ddb
            path = config.get("path", "")
            from pathlib import Path as _Path
            target = _Path(path) if _Path(path).is_absolute() else ws / path
            c = _ddb.connect(":memory:")
            try:
                if conn_type == "csv":
                    inner = f"read_csv_auto('{target.as_posix()}')"
                elif conn_type == "parquet":
                    if target.is_dir():
                        inner = f"read_parquet('{target.as_posix()}/*.parquet')"
                    else:
                        inner = f"read_parquet('{target.as_posix()}')"
                else:  # delta
                    c.execute("INSTALL delta; LOAD delta;")
                    inner = f"delta_scan('{target.as_posix()}')"
                wrapped = f"SELECT * FROM ({sql.rstrip(';')}) __q LIMIT {limit}" if sql.strip().upper().startswith("SELECT") else sql
                res = c.execute(wrapped)
                columns = [d[0] for d in res.description]
                rows = [list(r) for r in res.fetchall()]
            finally:
                c.close()
            return {"columns": columns, "rows": rows, "row_count": len(rows)}

        raise HTTPException(status_code=400, detail=f"Query not supported for connection type: {conn_type}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
