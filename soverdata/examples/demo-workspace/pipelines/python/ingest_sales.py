"""
Ingestion pipeline: reads sales_raw.csv and writes to the Bronze lakehouse as Parquet.

Run via the UI or: soverdata run ingest_sales --pipeline-type python --workspace <path>
"""
import os
import pandas as pd
from pathlib import Path
from server.engine.lakehouse import write_table

workspace = Path(os.environ.get("SOVERDATA_WORKSPACE", "."))
lakehouse = Path(os.environ.get("SOVERDATA_LAKEHOUSE", workspace / "lakehouse"))

# ── Read source ──────────────────────────────────────────────────
csv_path = workspace / "data" / "sales_raw.csv"
if not csv_path.exists():
    raise FileNotFoundError(f"Source file not found: {csv_path}")

df = pd.read_csv(csv_path, parse_dates=["order_date"])
print(f"Read {len(df)} rows from {csv_path}")

# ── Write to Bronze ───────────────────────────────────────────────
out_file = write_table(df, lakehouse, "bronze", "sales")
print(f"Written {len(df)} rows to {out_file}")
