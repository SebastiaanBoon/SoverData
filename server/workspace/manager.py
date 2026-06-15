import os
import yaml
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class WorkspaceManager:
    def __init__(self, workspace_path: str = None):
        if workspace_path is None:
            # Look for environment variable or use a default
            workspace_path = os.environ.get("SOVERDATA_WORKSPACE", "workspace")
        self.path = Path(workspace_path).resolve()
        self.ensure_workspace_structure()

    def ensure_workspace_structure(self):
        """Creates the workspace folder and standard directories if they don't exist."""
        self.path.mkdir(parents=True, exist_ok=True)
        
        # Standard subdirectories
        (self.path / "connections").mkdir(exist_ok=True)
        (self.path / "pipelines" / "python").mkdir(parents=True, exist_ok=True)
        (self.path / "pipelines" / "sql").mkdir(parents=True, exist_ok=True)
        (self.path / "lakehouse" / "bronze").mkdir(parents=True, exist_ok=True)
        (self.path / "lakehouse" / "silver").mkdir(parents=True, exist_ok=True)
        (self.path / "lakehouse" / "gold").mkdir(parents=True, exist_ok=True)
        (self.path / "catalog").mkdir(exist_ok=True)
        (self.path / "runs").mkdir(exist_ok=True)

        # Create workspace.yaml if not exists
        config_path = self.path / "workspace.yaml"
        if not config_path.exists():
            default_config = {
                "name": self.path.name,
                "format_version": "1.0",
                "description": "SoverData Workspace"
            }
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.safe_dump(default_config, f, default_flow_style=False)
            logger.info(f"Initialized new workspace at {self.path}")

    def get_config(self):
        """Reads workspace.yaml config."""
        config_path = self.path / "workspace.yaml"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)
        return {}

    def list_connections(self):
        """List all connections defined in the connections/ folder."""
        connections = []
        conn_dir = self.path / "connections"
        for f in conn_dir.glob("*.yaml"):
            try:
                with open(f, "r", encoding="utf-8") as file:
                    conn_data = yaml.safe_load(file)
                    if conn_data:
                        conn_data["name"] = f.stem
                        connections.append(conn_data)
            except Exception as e:
                logger.error(f"Failed to read connection file {f}: {e}")
        return connections

    def get_connection(self, name: str):
        """Get specific connection configuration."""
        f = self.path / "connections" / f"{name}.yaml"
        if f.exists():
            with open(f, "r", encoding="utf-8") as file:
                conn_data = yaml.safe_load(file)
                if conn_data:
                    conn_data["name"] = name
                    return conn_data
        return None

    def save_connection(self, name: str, config: dict):
        """Save a connection configuration (excluding name in the yaml itself)."""
        f = self.path / "connections" / f"{name}.yaml"
        # Ensure we don't save name inside if it's already there
        config_to_save = config.copy()
        config_to_save.pop("name", None)
        with open(f, "w", encoding="utf-8") as file:
            yaml.safe_dump(config_to_save, file, default_flow_style=False)
        logger.info(f"Saved connection {name} to {f}")
        return True

    def delete_connection(self, name: str):
        """Delete connection config file."""
        f = self.path / "connections" / f"{name}.yaml"
        if f.exists():
            f.unlink()
            return True
        return False

    def list_pipelines(self):
        """List all pipelines in python and sql folders."""
        pipelines = []
        
        # Python pipelines
        py_dir = self.path / "pipelines" / "python"
        for f in py_dir.glob("*.py"):
            pipelines.append({
                "name": f.stem,
                "type": "python",
                "file_path": str(f.relative_to(self.path))
            })
            
        # SQL pipelines
        sql_dir = self.path / "pipelines" / "sql"
        for f in sql_dir.glob("*.sql"):
            pipelines.append({
                "name": f.stem,
                "type": "sql",
                "file_path": str(f.relative_to(self.path))
            })
            
        return pipelines

    def get_pipeline(self, name: str, pipeline_type: str):
        """Get content of a pipeline file."""
        extension = "py" if pipeline_type == "python" else "sql"
        f = self.path / "pipelines" / pipeline_type / f"{name}.{extension}"
        if f.exists():
            with open(f, "r", encoding="utf-8") as file:
                return {
                    "name": name,
                    "type": pipeline_type,
                    "content": file.read(),
                    "file_path": str(f.relative_to(self.path))
                }
        return None

    def save_pipeline(self, name: str, pipeline_type: str, content: str):
        """Save a pipeline file (creates directories if necessary)."""
        extension = "py" if pipeline_type == "python" else "sql"
        f = self.path / "pipelines" / pipeline_type / f"{name}.{extension}"
        f.parent.mkdir(parents=True, exist_ok=True)
        with open(f, "w", encoding="utf-8") as file:
            file.write(content)
        logger.info(f"Saved pipeline {name} ({pipeline_type}) to {f}")
        return {
            "name": name,
            "type": pipeline_type,
            "file_path": str(f.relative_to(self.path))
        }

    def delete_pipeline(self, name: str, pipeline_type: str):
        """Delete pipeline file."""
        extension = "py" if pipeline_type == "python" else "sql"
        f = self.path / "pipelines" / pipeline_type / f"{name}.{extension}"
        if f.exists():
            f.unlink()
            return True
        return False

    def list_lakehouse_tables(self):
        """Lists all Delta Tables in Medallion layers."""
        tables = []
        lakehouse_path = self.path / "lakehouse"
        for tier in ["bronze", "silver", "gold"]:
            tier_path = lakehouse_path / tier
            if tier_path.exists():
                for table_dir in tier_path.iterdir():
                    if table_dir.is_dir() and (table_dir / "_delta_log").exists():
                        tables.append({
                            "name": table_dir.name,
                            "tier": tier,
                            "path": str(table_dir.relative_to(self.path))
                        })
        return tables
