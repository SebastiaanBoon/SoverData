import os
from pathlib import Path
from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import logging
from sqlalchemy import create_engine
import requests

from server.workspace.manager import WorkspaceManager
from server.orchestrator.runner import PipelineRunner
from server.engine.query_engine import QueryEngine
from server.orchestrator.scheduler import BackgroundScheduler
from server.workspace.lineage import LineageAnalyzer
from server.workspace.ai_copilot import AICopilot

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Initialize FastAPI App
app = FastAPI(title="SoverData REST API", version="0.1.0")

# Setup CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active workspace path (resolved dynamically)
active_ws_path = os.environ.get("SOVERDATA_WORKSPACE", "workspace")
ws_manager = WorkspaceManager(active_ws_path)
runner = PipelineRunner(active_ws_path)
query_engine = QueryEngine(active_ws_path)
lineage_analyzer = LineageAnalyzer(active_ws_path)
ai_copilot = AICopilot(active_ws_path)

# Models
class CopilotModel(BaseModel):
    prompt: str
    pipeline_type: str = "python"
    provider: str = "openai"
    api_key: Optional[str] = None
    model_name: Optional[str] = None

# Models
class ConnectionModel(BaseModel):
    type: str = Field(..., description="E.g. sqlite, postgresql, rest, files")
    url: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    user: Optional[str] = None
    password: Optional[str] = None
    database: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    description: Optional[str] = ""

class PipelineModel(BaseModel):
    content: str = Field(..., description="Python code or SQL statement content.")

class QueryRequest(BaseModel):
    sql: str = Field(..., description="SQL Query matching DuckDB/Delta catalog.")

class WorkspaceConfigModel(BaseModel):
    name: str
    description: Optional[str] = ""
    schedules: Optional[List[Dict[str, Any]]] = []

# Router
api_router = APIRouter(prefix="/api")

# Workspace Configuration
@api_router.get("/workspace")
def get_workspace_info():
    config = ws_manager.get_config()
    return {
        "path": str(ws_manager.path),
        "name": config.get("name"),
        "description": config.get("description"),
        "format_version": config.get("format_version", "1.0"),
        "schedules": config.get("schedules", [])
    }

@api_router.post("/workspace")
def update_workspace_info(body: WorkspaceConfigModel):
    try:
        config_path = ws_manager.path / "workspace.yaml"
        import yaml
        
        # Merge fields
        current = ws_manager.get_config()
        current["name"] = body.name
        current["description"] = body.description
        current["schedules"] = body.schedules
        
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(current, f, default_flow_style=False)
        return {"status": "success", "config": current}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Connections Management
@api_router.get("/connections")
def list_connections():
    return ws_manager.list_connections()

@api_router.get("/connections/{name}")
def get_connection(name: str):
    conn = ws_manager.get_connection(name)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn

@api_router.post("/connections/{name}")
def create_or_update_connection(name: str, conn: ConnectionModel):
    try:
        ws_manager.save_connection(name, conn.model_dump())
        return {"status": "success", "message": f"Connection '{name}' saved."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/connections/{name}")
def delete_connection(name: str):
    if ws_manager.delete_connection(name):
        return {"status": "success", "message": f"Connection '{name}' deleted."}
    raise HTTPException(status_code=404, detail="Connection not found")

@api_router.post("/connections/{name}/test")
def test_connection(name: str):
    conn = ws_manager.get_connection(name)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    conn_type = conn.get("type", "").lower()
    try:
        if conn_type in ["postgresql", "postgres", "mssql", "mysql", "sqlite"]:
            # Test relational database
            url = conn.get("url") or conn.get("connection_string")
            if not url:
                host = conn.get("host")
                port = conn.get("port")
                user = conn.get("user")
                password = conn.get("password")
                database = conn.get("database")
                if conn_type == "sqlite":
                    url = f"sqlite:///{database}"
                elif host:
                    driver = "postgresql" if "postgres" in conn_type else conn_type
                    url = f"{driver}://{user}:{password}@{host}:{port}/{database}"
            
            if not url:
                return {"status": "failed", "detail": "Missing URL or connection parameters."}
                
            engine = create_engine(url)
            with engine.connect() as con:
                con.execute(con.text("SELECT 1"))
            return {"status": "success", "message": "Successfully connected to SQL database!"}
            
        elif conn_type == "rest":
            # Test REST service
            url = conn.get("base_url") or conn.get("url")
            if not url:
                return {"status": "failed", "detail": "Missing API host or URL."}
            headers = conn.get("headers", {}).copy()
            if conn.get("api_key") and conn.get("auth_type") == "bearer":
                headers["Authorization"] = f"Bearer {conn['api_key']}"
            
            res = requests.get(url, headers=headers, timeout=10)
            res.raise_for_status()
            return {"status": "success", "message": f"Rest API answered with status code {res.status_code}"}
        else:
            return {"status": "warning", "message": f"Connection of type '{conn_type}' lacks an automatic validator, but configurations are saved."}
    except Exception as e:
        return {"status": "failed", "detail": str(e)}

# Pipelines Management
@api_router.get("/pipelines")
def list_pipelines():
    return ws_manager.list_pipelines()

@api_router.get("/pipelines/{pipeline_type}/{name}")
def get_pipeline(pipeline_type: str, name: str):
    if pipeline_type not in ["python", "sql"]:
        raise HTTPException(status_code=400, detail="Invalid pipeline type. Must be python or sql.")
    pipe = ws_manager.get_pipeline(name, pipeline_type)
    if not pipe:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return pipe

@api_router.post("/pipelines/{pipeline_type}/{name}")
def save_pipeline(pipeline_type: str, name: str, body: PipelineModel):
    if pipeline_type not in ["python", "sql"]:
        raise HTTPException(status_code=400, detail="Invalid pipeline type. Must be python or sql.")
    try:
        res = ws_manager.save_pipeline(name, pipeline_type, body.content)
        return {"status": "success", "pipeline": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/pipelines/{pipeline_type}/{name}")
def delete_pipeline(pipeline_type: str, name: str):
    if pipeline_type not in ["python", "sql"]:
        raise HTTPException(status_code=400, detail="Invalid pipeline type")
    if ws_manager.delete_pipeline(name, pipeline_type):
        return {"status": "success", "message": f"Pipeline '{name}' deleted."}
    raise HTTPException(status_code=404, detail="Pipeline not found")

@api_router.post("/pipelines/{pipeline_type}/{name}/run")
def run_pipeline(pipeline_type: str, name: str, background_tasks: BackgroundTasks):
    """Triggers the execution of a pipeline either synchronously or schedules in background."""
    # Run in background tasks to prevent HTTP timeout
    background_tasks.add_task(runner.run_pipeline, name, pipeline_type)
    return {"status": "triggered", "message": f"Pipeline '{name}' execution started in the background."}

# Runs History
@api_router.get("/runs")
def list_runs():
    return runner.list_runs()

@api_router.get("/runs/{run_id}")
def get_run_details(run_id: str):
    details = runner.get_run_details(run_id)
    if not details:
        raise HTTPException(status_code=404, detail="Run history not found")
    return details

# Catalog & Query Console
@api_router.get("/catalog/tables")
def list_lakehouse_tables():
    return ws_manager.list_lakehouse_tables()

@api_router.get("/catalog/lineage")
def get_workspace_lineage():
    try:
        return lineage_analyzer.generate_lineage()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lineage analysis failed: {e}")

@api_router.post("/copilot/generate")
def copilot_generate_pipeline(body: CopilotModel):
    try:
        res = ai_copilot.generate_code(
            prompt=body.prompt,
            pipeline_type=body.pipeline_type,
            provider=body.provider,
            api_key=body.api_key,
            model=body.model_name
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return ws_manager.list_lakehouse_tables()

@api_router.get("/catalog/tables/{tier}/{name}/preview")
def preview_table(tier: str, name: str, limit: int = 50):
    if tier not in ["bronze", "silver", "gold"]:
        raise HTTPException(status_code=400, detail="Invalid tier")
    try:
        # Construct and run DuckDB query
        query = f"SELECT * FROM {tier}.{name} LIMIT {limit}"
        res = query_engine.execute_query(query)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load Delta table preview: {e}")

@api_router.post("/query")
def run_custom_query(body: QueryRequest):
    try:
        res = query_engine.execute_query(body.sql)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Register API Router
app.include_router(api_router)

# Mount Static Files (Serving Web UI later)
ui_path = Path(__file__).resolve().parents[2] / "ui"
if ui_path.exists():
    app.mount("/", StaticFiles(directory=str(ui_path), html=True), name="ui")

# Background scheduler lifecycle management
scheduler = None

@app.on_event("startup")
def start_scheduler():
    global scheduler
    logger.info(f"FastAPI startup event: launching BackgroundScheduler on workspace '{active_ws_path}'")
    scheduler = BackgroundScheduler(active_ws_path)
    scheduler.start()

@app.on_event("shutdown")
def stop_scheduler():
    global scheduler
    if scheduler:
        logger.info("FastAPI shutdown event: stopping BackgroundScheduler")
        scheduler.stop()

