"""FastAPI application factory."""
import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.api import (
    branches,
    catalog,
    connections,
    files,
    lakehouse,
    orchestrations,
    packages,
    pipelines,
    query,
    runs,
    stats,
    workspace,
)
from server.config import app_state
from server.engine.lakehouse import cleanup_bronze_retention
from server.orchestrator.scheduler import run_due_triggers


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_retention_loop())
    trigger_task = asyncio.create_task(_trigger_loop())
    try:
        yield
    finally:
        task.cancel()
        trigger_task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        try:
            await trigger_task
        except asyncio.CancelledError:
            pass


async def _retention_loop() -> None:
    while True:
        await asyncio.sleep(3600)
        if app_state.is_open():
            try:
                cleanup_bronze_retention(app_state.require_workspace())
            except Exception:
                pass


async def _trigger_loop() -> None:
    while True:
        await asyncio.sleep(30)
        if app_state.is_open():
            try:
                await run_due_triggers(app_state.require_workspace())
            except Exception:
                pass


app = FastAPI(title="SoverData API", version="0.1.0", lifespan=lifespan)

_default_workspace = os.environ.get("SOVERDATA_WORKSPACE")
if _default_workspace:
    _workspace_path = Path(_default_workspace)
    if not _workspace_path.is_absolute():
        _workspace_path = Path.cwd() / _workspace_path
    if _workspace_path.exists():
        app_state.set_workspace(str(_workspace_path))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(connections.router, prefix="/api/connections", tags=["connections"])
app.include_router(pipelines.router, prefix="/api/pipelines", tags=["pipelines"])
app.include_router(runs.router, prefix="/api/runs", tags=["runs"])
app.include_router(catalog.router, prefix="/api/catalog", tags=["catalog"])
app.include_router(branches.router, prefix="/api/branches", tags=["branches"])
app.include_router(query.router, prefix="/api/query", tags=["query"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(packages.router, prefix="/api/packages", tags=["packages"])
app.include_router(orchestrations.router, prefix="/api/orchestrations", tags=["orchestrations"])
app.include_router(lakehouse.router, prefix="/api/lakehouse", tags=["lakehouse"])
app.include_router(files.router, prefix="/api/files", tags=["files"])

# Serve React SPA from ui/dist when available
_ui_dist = Path(__file__).parent.parent / "ui" / "dist"

if _ui_dist.exists():
    _assets = _ui_dist / "assets"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = _ui_dist / "index.html"
        return FileResponse(str(index))
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return {
            "status": "running",
            "message": "SoverData API is running. Build the UI to use the browser interface.",
            "docs": "/docs",
            "instructions": "cd ui && npm install && npm run build",
        }
