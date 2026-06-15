"""Delta Lake helpers using delta-rs (deltalake Python bindings)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa


def write_delta(path: Path, df: pd.DataFrame, mode: str = "append") -> None:
    """Write a DataFrame to a Delta table at `path`."""
    try:
        from deltalake.writer import write_deltalake
        write_deltalake(str(path), df, mode=mode)
    except ImportError:
        # Fallback: write as Parquet
        import datetime
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path.mkdir(parents=True, exist_ok=True)
        df.to_parquet(path / f"part-{ts}.parquet", index=False)


def read_delta(path: Path) -> pd.DataFrame:
    """Read a Delta table into a DataFrame."""
    try:
        from deltalake import DeltaTable
        dt = DeltaTable(str(path))
        return dt.to_pandas()
    except Exception:
        # Fallback: read Parquet files
        import glob
        files = glob.glob(str(path / "*.parquet"))
        if not files:
            return pd.DataFrame()
        return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


def get_delta_history(path: Path) -> list[dict]:
    """Return the Delta transaction log history."""
    try:
        from deltalake import DeltaTable
        dt = DeltaTable(str(path))
        history = dt.history()
        return history
    except Exception:
        return []


def table_exists(path: Path) -> bool:
    return (path / "_delta_log").exists() or bool(list(path.glob("*.parquet")))
