import os
import sys
import uuid
import json
import time
import subprocess
import trace
from pathlib import Path
import logging
from datetime import datetime
from server.engine.query_engine import QueryEngine
from server.workspace.manager import WorkspaceManager

logger = logging.getLogger(__name__)

class PipelineRunner:
    def __init__(self, workspace_path: str):
        self.workspace_path = Path(workspace_path).resolve()
        self.workspace_manager = WorkspaceManager(str(self.workspace_path))
        self.query_engine = QueryEngine(str(self.workspace_path))

    def run_pipeline(self, pipeline_name: str, pipeline_type: str) -> dict:
        """Run a Python or SQL pipeline and write run history / logs to the runs/ directory."""
        run_id = str(uuid.uuid4())
        started_at = datetime.utcnow().isoformat()
        start_time = time.time()
        
        runs_dir = self.workspace_path / "runs"
        runs_dir.mkdir(exist_ok=True)
        
        # Prepare run log and data files
        log_file_path = runs_dir / f"{run_id}.log"
        meta_file_path = runs_dir / f"{run_id}.json"
        
        status = "success"
        error_msg = None
        logs = []

        def log_write(msg: str):
            timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            log_line = f"[{timestamp}] {msg}"
            logs.append(log_line)
            with open(log_file_path, "a", encoding="utf-8") as lf:
                lf.write(log_line + "\n")

        log_write(f"Starting pipeline {pipeline_name} ({pipeline_type}) with Run ID {run_id}")

        try:
            if pipeline_type == "python":
                # Run Python pipeline
                py_file = self.workspace_path / "pipelines" / "python" / f"{pipeline_name}.py"
                if not py_file.exists():
                    raise FileNotFoundError(f"Python pipeline file not found: {py_file}")
                
                # Execute in subprocess. Setup PYTHONPATH to include our repo path.
                repo_root = Path(__file__).resolve().parents[2]
                env = os.environ.copy()
                env["SOVERDATA_WORKSPACE"] = str(self.workspace_path)
                # Ensure the current directory and parent (which has soverdata module) is in PYTHONPATH
                env["PYTHONPATH"] = os.path.pathsep.join([
                    str(repo_root),
                    str(self.workspace_path),
                    env.get("PYTHONPATH", "")
                ])
                
                log_write(f"Executing subprocess: {sys.executable} {py_file}")
                process = subprocess.Popen(
                    [sys.executable, str(py_file)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env=env
                )
                
                while True:
                    line = process.stdout.readline()
                    if not line:
                        break
                    log_write(line.strip())
                
                process.wait()
                if process.returncode != 0:
                    raise subprocess.CalledProcessError(process.returncode, py_file)
                    
            elif pipeline_type == "sql":
                # Run SQL pipeline
                sql_file = self.workspace_path / "pipelines" / "sql" / f"{pipeline_name}.sql"
                if not sql_file.exists():
                    raise FileNotFoundError(f"SQL pipeline file not found: {sql_file}")
                    
                with open(sql_file, "r", encoding="utf-8") as f:
                    sql_content = f.read()
                
                # Parse target from filename or annotations
                # E.g., silver_customers.sql -> tier: silver, table: customers
                target_tier = None
                target_table = None
                
                # Check for in-file annotation: -- target: silver.customers
                for line in sql_content.splitlines():
                    if line.strip().startswith("-- target:"):
                        annotation = line.split(":", 1)[1].strip()
                        if "." in annotation:
                            target_tier, target_table = annotation.split(".", 1)
                        break
                
                # Check conventionally if annotation not found
                if not target_table:
                    if "_" in pipeline_name:
                        parts = pipeline_name.split("_", 1)
                        if parts[0] in ["bronze", "silver", "gold"]:
                            target_tier = parts[0]
                            target_table = parts[1]
                
                log_write(f"Running SQL against DuckDB Engine. Detected target: {target_tier}.{target_table if target_table else '(None)'}")
                
                if target_tier and target_table:
                    # Execute and fetch as pandas DataFrame to write to delta
                    # First run any prerequisite setups/transform queries
                    df = self.query_engine.con.execute(sql_content).df()
                    log_write(f"Writing {len(df)} rows to Delta table: {target_tier}.{target_table}")
                    self.query_engine.write_delta(df, target_tier, target_table, mode="overwrite")
                else:
                    # Generic execution
                    self.query_engine.execute_query(sql_content)
                    log_write("SQL script executed successfully (no target Delta table detected)")

            else:
                raise ValueError(f"Unknown pipeline type {pipeline_type}")
                
            log_write(f"Successfully completed running pipeline {pipeline_name}!")
            
        except Exception as e:
            status = "failed"
            error_msg = str(e)
            log_write(f"ERROR: Pipeline execution failed: {e}")
            logger.exception(f"Pipeline {pipeline_name} failed")

        ended_at = datetime.utcnow().isoformat()
        duration = time.time() - start_time
        
        run_meta = {
            "run_id": run_id,
            "pipeline_name": pipeline_name,
            "pipeline_type": pipeline_type,
            "status": status,
            "started_at": started_at,
            "ended_at": ended_at,
            "duration": round(duration, 3),
            "error_msg": error_msg
        }
        
        with open(meta_file_path, "w", encoding="utf-8") as mf:
            json.dump(run_meta, mf, indent=2)
            
        return run_meta
        
    def list_runs(self) -> list:
        """List all run executions and metadata from the workspace runs/ directory."""
        runs_dir = self.workspace_path / "runs"
        if not runs_dir.exists():
            return []
            
        runs_list = []
        for meta_file in runs_dir.glob("*.json"):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    runs_list.append(json.load(f))
            except Exception as e:
                logger.error(f"Failed to read run metadata from {meta_file}: {e}")
                
        # Sort by started_at descending
        runs_list.sort(key=lambda x: x.get("started_at", ""), reverse=True)
        return runs_list

    def get_run_details(self, run_id: str) -> dict:
        """Get complete run metadata and logs."""
        meta_file = self.workspace_path / "runs" / f"{run_id}.json"
        log_file = self.workspace_path / "runs" / f"{run_id}.log"
        
        if not meta_file.exists():
            return None
            
        with open(meta_file, "r", encoding="utf-8") as f:
            meta = json.load(f)
            
        logs_content = ""
        if log_file.exists():
            with open(log_file, "r", encoding="utf-8") as f:
                logs_content = f.read()
                
        meta["logs"] = logs_content
        return meta
