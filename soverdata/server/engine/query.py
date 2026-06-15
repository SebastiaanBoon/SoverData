"""DuckDB query engine — reads Delta and Parquet tables from the lakehouse."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import duckdb


def _get_conn(workspace_path: Path | None = None) -> duckdb.DuckDBPyConnection:
    """Return an in-memory DuckDB connection with Delta and spatial extensions."""
    conn = duckdb.connect(":memory:")
    # Register lakehouse tables as views when a workspace is provided
    if workspace_path:
        _register_lakehouse(conn, workspace_path)
    return conn


def _register_lakehouse(conn: duckdb.DuckDBPyConnection, workspace_path: Path) -> None:
    """Register Delta and Parquet tables in the lakehouse as DuckDB views."""
    lakehouse = workspace_path / "lakehouse"
    if not lakehouse.exists():
        return

    # Try to install and load delta extension (may already be present)
    try:
        conn.execute("INSTALL delta; LOAD delta;")
    except Exception:
        pass  # Older DuckDB versions or network-restricted environments

    for layer in ("bronze", "silver", "gold"):
        layer_dir = lakehouse / layer
        if not layer_dir.exists():
            continue
        for table_dir in layer_dir.iterdir():
            if not table_dir.is_dir():
                continue
            name = f"{layer}__{table_dir.name}"
            path_str = table_dir.as_posix()
            delta_log = table_dir / "_delta_log"
            parquet_files = list(table_dir.glob("*.parquet"))

            if delta_log.exists():
                try:
                    conn.execute(f"CREATE OR REPLACE VIEW {_quote(name)} AS SELECT * FROM delta_scan('{path_str}')")
                    continue
                except Exception:
                    pass  # Fall back to Parquet scan

            if parquet_files:
                try:
                    conn.execute(
                        f"CREATE OR REPLACE VIEW {_quote(name)} AS SELECT * FROM read_parquet('{path_str}/*.parquet')"
                    )
                except Exception:
                    pass


def execute_sql(sql: str, workspace_path: Path | None = None, limit: int = 1000) -> dict:
    """Execute SQL and return a dict with columns + rows."""
    conn = _get_conn(workspace_path)
    try:
        # Wrap in a limit if not already present and it looks like a SELECT
        trimmed = sql.strip().rstrip(";")
        if re.match(r"^\s*select", trimmed, re.IGNORECASE) and "limit" not in trimmed.lower():
            trimmed = f"SELECT * FROM ({trimmed}) __q LIMIT {limit}"
        result = conn.execute(trimmed)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        return {
            "columns": columns,
            "rows": [list(r) for r in rows],
            "row_count": len(rows),
        }
    finally:
        conn.close()


def get_table_schema(table_path: Path) -> list[dict]:
    """Return column names and types for a table directory."""
    conn = duckdb.connect(":memory:")
    try:
        path_str = table_path.as_posix()
        delta_log = table_path / "_delta_log"
        parquet_files = list(table_path.glob("*.parquet"))

        if delta_log.exists():
            try:
                conn.execute("INSTALL delta; LOAD delta;")
                conn.execute(f"CREATE OR REPLACE VIEW __t AS SELECT * FROM delta_scan('{path_str}')")
            except Exception:
                if parquet_files:
                    conn.execute(f"CREATE OR REPLACE VIEW __t AS SELECT * FROM read_parquet('{path_str}/*.parquet')")
                else:
                    return []
        elif parquet_files:
            conn.execute(f"CREATE OR REPLACE VIEW __t AS SELECT * FROM read_parquet('{path_str}/*.parquet')")
        else:
            return []

        result = conn.execute("DESCRIBE __t").fetchall()
        return [{"name": r[0], "type": r[1], "nullable": r[2] != "NO"} for r in result]
    except Exception:
        return []
    finally:
        conn.close()


def preview_table(table_path: Path, limit: int = 100) -> dict:
    """Return a preview of the first `limit` rows of a table."""
    conn = duckdb.connect(":memory:")
    try:
        path_str = table_path.as_posix()
        delta_log = table_path / "_delta_log"
        parquet_files = list(table_path.glob("*.parquet"))

        if delta_log.exists():
            try:
                conn.execute("INSTALL delta; LOAD delta;")
                sql = f"SELECT * FROM delta_scan('{path_str}') LIMIT {limit}"
            except Exception:
                sql = f"SELECT * FROM read_parquet('{path_str}/*.parquet') LIMIT {limit}"
        elif parquet_files:
            sql = f"SELECT * FROM read_parquet('{path_str}/*.parquet') LIMIT {limit}"
        else:
            return {"columns": [], "rows": []}

        result = conn.execute(sql)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        return {
            "columns": columns,
            "rows": [[_safe_val(v) for v in row] for row in rows],
        }
    except Exception as e:
        return {"columns": [], "rows": [], "error": str(e)}
    finally:
        conn.close()


def get_table_row_count(table_path: Path) -> int | None:
    """Return the row count of a table, or None on error."""
    conn = duckdb.connect(":memory:")
    try:
        path_str = table_path.as_posix()
        delta_log = table_path / "_delta_log"
        parquet_files = list(table_path.glob("*.parquet"))

        if delta_log.exists():
            try:
                conn.execute("INSTALL delta; LOAD delta;")
                sql = f"SELECT COUNT(*) FROM delta_scan('{path_str}')"
            except Exception:
                if parquet_files:
                    sql = f"SELECT COUNT(*) FROM read_parquet('{path_str}/*.parquet')"
                else:
                    return None
        elif parquet_files:
            sql = f"SELECT COUNT(*) FROM read_parquet('{path_str}/*.parquet')"
        else:
            return None

        row = conn.execute(sql).fetchone()
        return int(row[0]) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def scan_lakehouse_tables(workspace_path: Path) -> list[dict]:
    """Discover all tables in the lakehouse by scanning the folder structure."""
    lakehouse = workspace_path / "lakehouse"
    tables = []
    if not lakehouse.exists():
        return tables

    for layer in ("bronze", "silver", "gold"):
        layer_dir = lakehouse / layer
        if not layer_dir.exists():
            continue
        for table_dir in layer_dir.iterdir():
            if not table_dir.is_dir():
                continue
            parquet_files = list(table_dir.glob("*.parquet"))
            has_delta = (table_dir / "_delta_log").exists()
            if not parquet_files and not has_delta:
                continue
            tables.append({
                "name": table_dir.name,
                "layer": layer,
                "path": str(table_dir.relative_to(workspace_path)),
                "format": "delta" if has_delta else "parquet",
            })
    return tables


def _quote(name: str) -> str:
    return f'"{name}"'


def _safe_val(v: Any) -> Any:
    """Coerce non-JSON-serializable types to string."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    return str(v)
