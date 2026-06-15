import os
import sqlite3
from pathlib import Path
import pandas as pd
from soverdata import context

# 1. Determine local sales.db path inside workspace
ws_path = context.workspace_path
db_path = ws_path / "sales.db"

# 2. If SQLite db doesn't exist, let's auto-seed it on the fly!
if not db_path.exists():
    print(f"Sales database not found at {db_path}. Auto-seeding mock tables...")
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    # Create customers table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT,
        country TEXT
    );
    """)
    
    # Create orders table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER,
        order_date TEXT,
        amount REAL
    );
    """)
    
    # Seed Customers
    customers = [
        (101, "Sven de Vries", "sven@soverdata.org", "Netherlands"),
        (102, "Sarah Connor", "sarah@skynet.com", "United States"),
        (103, "Emma Watson", "emma@hogwarts.uk", "United Kingdom"),
        (104, "John Doe", "john.doe@gmail.com", "Netherlands"),
        (105, "Hans Schmidt", "hans.schmidt@berlin.de", "Germany")
    ]
    cursor.executemany("INSERT INTO customers VALUES (?, ?, ?, ?)", customers)
    
    # Seed Orders
    orders = [
        (1, 101, "2026-06-01", 1250.50),
        (2, 101, "2026-06-05", 450.00),
        (3, 102, "2026-06-02", 99.99),
        (4, 103, "2026-06-03", 4200.00),
        (5, 104, "2026-06-04", 15.50),
        (6, 105, "2026-06-10", 350.00),
        (7, 102, "2026-06-12", 1500.00),
        (8, 101, "2026-06-14", 75.00)
    ]
    cursor.executemany("INSERT INTO orders VALUES (?, ?, ?, ?)", orders)
    
    conn.commit()
    conn.close()
    print("Successfully seeded sales.db!")

# 3. Read Relational database records using context read_sql helper
print("Reading 'customers' table from local_db connection...")
df_customers = context.read_sql("SELECT * FROM customers", "local_db")

print("Reading 'orders' table from local_db connection...")
df_orders = context.read_sql("SELECT * FROM orders", "local_db")

# 4. Ingest and persist data directly into Medallion Bronze Delta Lakes!
print("Ingesting customers dataset into 'bronze.customers' Delta table...")
context.write_delta(df_customers, "bronze", "customers")

print("Ingesting orders dataset into 'bronze.orders' Delta table...")
context.write_delta(df_orders, "bronze", "orders")

print("Ingestion pipeline successfully completed!")
