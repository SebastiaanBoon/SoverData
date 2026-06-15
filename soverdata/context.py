import os
import yaml
import sys
from pathlib import Path
import pandas as pd
from sqlalchemy import create_engine
import logging

logger = logging.getLogger(__name__)

class PipelineContext:
    def __init__(self):
        # Determine workspace path
        ws_env = os.environ.get("SOVERDATA_WORKSPACE")
        if ws_env:
            self.workspace_path = Path(ws_env).resolve()
        else:
            # Fallback to finding standard workspace yaml in parent directories or current
            current = Path.cwd()
            found = False
            for p in [current] + list(current.parents):
                if (p / "workspace.yaml").exists():
                    self.workspace_path = p
                    found = True
                    break
            if not found:
                self.workspace_path = Path("workspace").resolve()
                
        # Lazy load the query engine to avoid circular import issues
        self._engine = None

    @property
    def engine(self):
        if self._engine is None:
            # Delay import to prevent circularity
            from server.engine.query_engine import QueryEngine
            self._engine = QueryEngine(str(self.workspace_path))
        return self._engine

    def get_connection(self, name: str) -> dict:
        """Fetch connection settings from workspace yaml files."""
        conn_path = self.workspace_path / "connections" / f"{name}.yaml"
        if not conn_path.exists():
            raise FileNotFoundError(f"Connection '{name}' not found at {conn_path}")
        with open(conn_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
            data["name"] = name
            return data

    def read_sql(self, query: str, connection_name: str) -> pd.DataFrame:
        """Execute SQL query on an external connection database and return a Pandas DataFrame."""
        conn = self.get_connection(connection_name)
        conn_type = conn.get("type", "").lower()
        
        if conn_type in ["postgresql", "postgres", "mssql", "mysql", "sqlite", "oracle"]:
            # Standard relational databases
            url = conn.get("url") or conn.get("connection_string")
            if not url:
                # Build from components if provided
                host = conn.get("host")
                port = conn.get("port")
                user = conn.get("user") or conn.get("username")
                password = conn.get("password")
                database = conn.get("database")
                if conn_type == "sqlite":
                    db_p = Path(database)
                    if not db_p.is_absolute():
                        db_p = self.workspace_path / db_p
                    url = f"sqlite:///{db_p.resolve()}"
                elif host:
                    driver = "postgresql" if "postgres" in conn_type else conn_type
                    url = f"{driver}://{user}:{password}@{host}:{port}/{database}"
            
            if not url:
                raise ValueError(f"No connection URL or parameters found for {connection_name}")
                
            db_engine = create_engine(url)
            logger.info(f"Executing external SQL query on connection {connection_name}")
            return pd.read_sql(query, db_engine)
            
        elif conn_type == "rest":
            raise NotImplementedError("For REST connections, please use the ingest_rest helper or Python requests directly.")
        else:
            raise ValueError(f"Unsupported connection type: {conn_type}")

    def ingest_rest(self, connection_name: str, endpoint: str = "", params: dict = None, headers: dict = None) -> pd.DataFrame:
        """Helper to fetch REST API data using configured connection base URL and API keys."""
        import requests
        conn = self.get_connection(connection_name)
        base_url = conn.get("base_url") or conn.get("url", "")
        auth_type = conn.get("auth_type")
        api_key = conn.get("api_key")
        
        full_headers = conn.get("headers", {}).copy()
        if headers:
            full_headers.update(headers)
            
        if auth_type == "bearer" and api_key:
            full_headers["Authorization"] = f"Bearer {api_key}"
        elif auth_type == "apikey" and api_key:
            key_name = conn.get("api_key_header", "X-API-Key")
            full_headers[key_name] = api_key

        url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}" if endpoint else base_url
        logger.info(f"Ingesting from REST Connection '{connection_name}': {url}")
        
        response = requests.get(url, params=params, headers=full_headers)
        response.raise_for_status()
        
        data = response.json()
        # Navigate nested JSON paths if configured
        json_path = conn.get("json_path")
        if json_path and isinstance(data, dict):
            for part in json_path.split("."):
                data = data.get(part, data)
                
        if isinstance(data, list):
            return pd.DataFrame(data)
        elif isinstance(data, dict):
            return pd.DataFrame([data])
        else:
            raise ValueError("Unexpected JSON response type - not a list or dictionary.")

    def query(self, sql_query: str) -> pd.DataFrame:
        """Query internal Delta lake/DuckDB workspace tables."""
        res = self.engine.execute_query(sql_query)
        return pd.DataFrame(res["rows"])

    def write_delta(self, df: pd.DataFrame, tier: str, table_name: str, mode: str = "overwrite"):
        """Write a DataFrame into Delta Lake in the workspace."""
        path = self.engine.write_delta(df, tier, table_name, mode)
        logger.info(f"Successfully wrote data to '{tier}.{table_name}' Delta table")
        return path

# Singleton context instance
context = PipelineContext()
