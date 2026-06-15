"""
Generate demo data for the demo-workspace.

Writes:
  examples/demo-workspace/data/sales_raw.csv
  examples/demo-workspace/lakehouse/bronze/sales/data.parquet

Run: python scripts/generate_demo_data.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DEMO = ROOT / "examples" / "demo-workspace"


def main():
    try:
        import pandas as pd
        import numpy as np
    except ImportError:
        print("pandas and numpy are required. Install with: pip install pandas numpy")
        sys.exit(1)

    rng = np.random.default_rng(42)

    categories = ["Electronics", "Clothing", "Home & Garden", "Sports", "Books"]
    products = {
        "Electronics": ["Laptop", "Headphones", "Tablet", "Smartwatch", "Camera"],
        "Clothing":    ["T-Shirt", "Jeans", "Jacket", "Sneakers", "Hat"],
        "Home & Garden": ["Coffee Maker", "Blender", "Plant Pot", "Candle", "Cushion"],
        "Sports":      ["Yoga Mat", "Dumbbells", "Running Shoes", "Water Bottle", "Bike Helmet"],
        "Books":       ["Python Cookbook", "Data Engineering", "SQL for Analytics", "Clean Code", "The Pragmatic Programmer"],
    }
    prices = {
        "Electronics": (50, 1500),
        "Clothing":    (15, 200),
        "Home & Garden": (10, 150),
        "Sports":      (10, 300),
        "Books":       (10, 60),
    }

    n = 500
    dates = pd.date_range("2023-01-01", "2024-06-30", freq="D")

    rows = []
    for i in range(1, n + 1):
        cat = rng.choice(categories)
        product = rng.choice(products[cat])
        lo, hi = prices[cat]
        unit_price = round(float(rng.uniform(lo, hi)), 2)
        quantity = int(rng.integers(1, 6))
        revenue = round(unit_price * quantity, 2)
        order_date = rng.choice(dates)
        rows.append({
            "order_id":   i,
            "order_date": pd.Timestamp(order_date).date().isoformat(),
            "category":   cat,
            "product":    product,
            "quantity":   quantity,
            "unit_price": unit_price,
            "revenue":    revenue,
            "region":     rng.choice(["EMEA", "AMER", "APAC"]),
            "channel":    rng.choice(["Online", "Store", "Partner"]),
        })

    df = pd.DataFrame(rows)
    df["order_date"] = pd.to_datetime(df["order_date"])

    # Write CSV
    data_dir = DEMO / "data"
    data_dir.mkdir(exist_ok=True)
    csv_path = data_dir / "sales_raw.csv"
    df.to_csv(csv_path, index=False)
    print(f"✓ CSV:     {csv_path}  ({len(df)} rows)")

    # Write Bronze Parquet
    bronze_dir = DEMO / "lakehouse" / "bronze" / "sales"
    bronze_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = bronze_dir / "data.parquet"
    df.to_parquet(parquet_path, index=False)
    print(f"✓ Parquet: {parquet_path}  ({len(df)} rows)")

    print("\nDemo data ready. Open the demo-workspace in SoverData:")
    print(f"  {DEMO}")


if __name__ == "__main__":
    main()
