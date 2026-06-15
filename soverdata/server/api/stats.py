"""Stats API — workspace-level summary statistics."""
from fastapi import APIRouter

from server.config import app_state
from server.workspace import manager as wm
from server.engine import query as engine

router = APIRouter()


@router.get("")
def get_stats():
    """Return summary counts for the open workspace."""
    if not app_state.is_open():
        return None
    ws = app_state.get_workspace()

    tables = engine.scan_lakehouse_tables(ws)
    pipelines = wm.list_pipelines(ws)
    connections = wm.list_connections(ws)
    runs = wm.list_runs(ws)

    last_run = runs[0] if runs else None

    by_layer: dict[str, int] = {}
    for t in tables:
        by_layer[t["layer"]] = by_layer.get(t["layer"], 0) + 1

    return {
        "tables": len(tables),
        "tables_by_layer": by_layer,
        "pipelines": len(pipelines),
        "connections": len(connections),
        "runs": len(runs),
        "last_run": {
            "pipeline": last_run.get("pipeline"),
            "status": last_run.get("status"),
            "started_at": last_run.get("started_at"),
        } if last_run else None,
    }
