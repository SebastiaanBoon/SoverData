"""Catalog API — table discovery, schema, and preview."""
from fastapi import APIRouter, HTTPException

from server.config import app_state
from server.workspace import manager as wm
from server.engine import query as engine

router = APIRouter()


@router.get("/tables")
def list_tables():
    ws = app_state.require_workspace()
    # Merge catalog metadata with live filesystem scan
    catalog_tables = {(t.get("layer"), t.get("name")): t for t in wm.get_catalog_tables(ws)}
    scanned = engine.scan_lakehouse_tables(ws)
    result = []
    for t in scanned:
        key = (t["layer"], t["name"])
        merged = {**catalog_tables.get(key, {}), **t}
        # Add row count
        table_path = ws / "lakehouse" / t["layer"] / t["name"]
        merged["row_count"] = engine.get_table_row_count(table_path)
        result.append(merged)
    return result


@router.get("/tables/{layer}/{name}/schema")
def get_table_schema(layer: str, name: str):
    ws = app_state.require_workspace()
    table_path = ws / "lakehouse" / layer / name
    if not table_path.exists():
        raise HTTPException(status_code=404, detail=f"Table not found: {layer}/{name}")
    schema = engine.get_table_schema(table_path)
    return {"layer": layer, "name": name, "schema": schema}


@router.get("/tables/{layer}/{name}/preview")
def preview_table(layer: str, name: str, limit: int = 100):
    ws = app_state.require_workspace()
    table_path = ws / "lakehouse" / layer / name
    if not table_path.exists():
        raise HTTPException(status_code=404, detail=f"Table not found: {layer}/{name}")
    return engine.preview_table(table_path, limit=limit)



@router.get("/tables/{layer}/{name}/schema")
def get_table_schema(layer: str, name: str):
    ws = app_state.require_workspace()
    table_path = ws / "lakehouse" / layer / name
    if not table_path.exists():
        raise HTTPException(status_code=404, detail=f"Table not found: {layer}/{name}")
    schema = engine.get_table_schema(table_path)
    return {"layer": layer, "name": name, "schema": schema}


@router.get("/tables/{layer}/{name}/preview")
def preview_table(layer: str, name: str, limit: int = 100):
    ws = app_state.require_workspace()
    table_path = ws / "lakehouse" / layer / name
    if not table_path.exists():
        raise HTTPException(status_code=404, detail=f"Table not found: {layer}/{name}")
    return engine.preview_table(table_path, limit=limit)
