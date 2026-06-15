import os
import duckdb
from deltalake import DeltaTable
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class QueryEngine:
    def __init__(self, workspace_path: str):
        self.workspace_path = Path(workspace_path).resolve()
        self.con = duckdb.connect(database=":memory:")  # Run in-process in-memory
        self.setup_schemas()
        self.refresh_catalog()

    def setup_schemas(self):
        """Create standard Medallion schemas in DuckDB."""
        self.con.execute("CREATE SCHEMA IF NOT EXISTS bronze;")
        self.con.execute("CREATE SCHEMA IF NOT EXISTS silver;")
        self.con.execute("CREATE SCHEMA IF NOT EXISTS gold;")

    def refresh_catalog(self):
        """Scans the lakehouse path and registers all Delta tables with DuckDB."""
        lakehouse_path = self.workspace_path / "lakehouse"
        if not lakehouse_path.exists():
            return

        for tier in ["bronze", "silver", "gold"]:
            tier_path = lakehouse_path / tier
            if not tier_path.exists():
                continue

            for table_dir in tier_path.iterdir():
                if table_dir.is_dir() and (table_dir / "_delta_log").exists():
                    table_name = table_dir.name
                    try:
                        dt = DeltaTable(str(table_dir))
                        dataset = dt.to_pyarrow_dataset()
                        temp_name = f"_temp_{tier}_{table_name}"
                        # Save Arrow dataset inside DuckDB context
                        self.con.register(temp_name, dataset)
                        # Create standard schema-scoped view
                        self.con.execute(f"CREATE OR REPLACE VIEW {tier}.{table_name} AS SELECT * FROM {temp_name}")
                        # Also register as tier_table_name flat view for compatibility
                        self.con.execute(f"CREATE OR REPLACE VIEW {tier}_{table_name} AS SELECT * FROM {temp_name}")
                        logger.info(f"Registered Delta table {tier}.{table_name} into DuckDB")
                    except Exception as e:
                        logger.warning(f"Failed to register Delta table at {table_dir}: {e}")

    def execute_query(self, query: str):
        """Executes a SQL query against the registered tables and returns result as a list of dicts."""
        self.refresh_catalog()
        try:
            rel = self.con.execute(query)
            if rel.description is None:
                return {"columns": [], "rows": [], "row_count": 0}
            columns = [desc[0] for desc in rel.description]
            rows = rel.fetchall()
            # Convert row tuples to standard Python types for JSON serialization
            serialized_rows = []
            for row in rows:
                serialized_row = []
                for val in row:
                    # DuckDB returns various times/dates/decimals, convert them to standard types
                    if hasattr(val, 'isoformat'):
                        serialized_row.append(val.isoformat())
                    else:
                        serialized_row.append(val)
                serialized_rows.append(dict(zip(columns, serialized_row)))
            
            return {
                "columns": columns,
                "rows": serialized_rows,
                "row_count": len(serialized_rows)
            }
        except Exception as e:
            logger.error(f"SQL execution error: {e}")
            raise e

    def write_delta(self, df, tier: str, table_name: str, mode: str = "overwrite"):
        """Writes a Pandas DataFrame to Delta Lake in the workspace and refreshes DuckDB."""
        if tier not in ["bronze", "silver", "gold"]:
            raise ValueError("Tier must be bronze, silver, or gold")
            
        target_dir = self.workspace_path / "lakehouse" / tier / table_name
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        
        from deltalake.writer import write_deltalake
        write_deltalake(str(target_dir), df, mode=mode)
        self.refresh_catalog()
        return str(target_dir)
