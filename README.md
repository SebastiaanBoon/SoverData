# SoverData - A Portable, Sovereign Data Platform

SoverData is a complete, Spark-free, file-based modern data platform packaged into a single Python library. It enables robust Medallion architectures (bronze, silver, gold data lakes) directly over local files using DuckDB and Delta Lake (via `delta-rs`), without any JVM, Spark, or server-level overhead.

## Key Features

- **App vs Workspace Separation**: The engine process is completely independent of your workspaces. Move, back up, or git-manage your workspace folder freely without touching the underlying engine.
- **DuckDB + Delta Lake**: Query, join, and optimize parquet data in-process. Fully offline, private, and exceptionally fast.
- **In-Process Scheduler**: Scheduled runs can be defined in standard Cron or periodic interval models inside `workspace.yaml`.
- **Relational & REST Ingestion**: Ingest databases (Postgres, SQL Server, etc.) and REST APIs directly into local Delta tables.
- **Bespoke Web UI**: Explore Delta tables, edit Python/SQL code, view executions history logs, and write raw Queries from a local interactive developer console.

---

## 3-Step Quick Start

### 1. Install Dependencies
Install SoverData and its core engine libraries:
```bash
pip install -e .
```

### 2. Run the Demo Ingestion Pipeline (Headless)
Run the pre-configured Python ingestion to pull and auto-seed raw customer checkout data:
```bash
soverdata run python ingest_sources --workspace examples/demo-workspace
```

### 3. Run the Silver SQL Transform (Headless)
Run the SQL transform script to join, clean, and enrich records:
```bash
soverdata run sql silver_sales_summary --workspace examples/demo-workspace
```

**To start the interactive Web UI and dynamic scheduler, simply serve your workspace:**
```bash
soverdata serve --workspace examples/demo-workspace --port 8000
```
Open your browser and traverse to [http://localhost:8000](http://localhost:8000)!

---

## Workspace Structure

Your workspace contains the complete database state and setup config matching standard Delta formats:
```
demo-workspace/
├── workspace.yaml              # Global config & schedule declarations
├── connections/                # Secure external credentials
├── pipelines/
│   ├── python/                 # Python Ingestions (.py)
│   └── sql/                    # DuckDB silver & gold Transforms (.sql)
├── lakehouse/
│   └── bronze/ silver/ gold/   # Real Delta tables (Parquet + _delta_log)
└── runs/                       # Output audit execution logs
```

---

*Powered by DuckDB, Delta Lake, FastAPI & Vue.*
