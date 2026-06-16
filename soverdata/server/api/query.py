"""Query API — ad-hoc SQL execution over the lakehouse."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import app_state
from server.engine import query as engine

router = APIRouter()


class QueryRequest(BaseModel):
    sql: str
    limit: int = 1000


@router.post("")
def execute_query(req: QueryRequest):
    ws = app_state.require_workspace()
    try:
        result = engine.execute_sql(req.sql, workspace_path=ws, limit=req.limit)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/tables")
def list_query_tables():
    """Return all registered lakehouse tables with their DuckDB view names."""
    ws = app_state.require_workspace()
    tables = engine.scan_lakehouse_tables(ws)
    return [
        {**t, "view_name": f"{t['layer']}.{t['name']}"}
        for t in tables
    ]
