# SoverData

A portable, sovereign data platform. Lakehouse + pipelines + orchestration + web UI — open source, file-based, no vendor lock-in.

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+ and npm

### Setup

```bash
# 1. Clone and install
git clone <repo>
cd soverdata
pip install -e .

# 2. Build the UI
cd ui
npm install
npm run build
cd ..

# 3. Start the server
soverdata serve

# 4. Open your browser
# http://localhost:8000
```

Or use the helper script:

```bash
python scripts/setup.py   # installs deps + builds UI
soverdata serve
```

## Usage

1. Open the browser at `http://localhost:8000`
2. Click **Open Workspace** and point to a folder (or **New Workspace** to create one)
3. Add **Connections** (CSV, Parquet, Postgres, REST)
4. Create **Pipelines** (Python or SQL)
5. Run pipelines and explore results in the **Catalog**
6. Query your lakehouse with the **SQL editor**

## Workspace Structure

Your workspace is a normal folder — portable, git-friendly, editor-friendly:

```
my-workspace/
├── workspace.yaml       # config + format version
├── connections/         # data source definitions
├── pipelines/
│   ├── python/          # ingestion scripts (.py)
│   └── sql/             # transform queries (.sql)
├── lakehouse/
│   ├── bronze/          # raw tables (Delta / Parquet)
│   ├── silver/          # cleaned tables
│   └── gold/            # business-ready tables
├── catalog/             # schemas, lineage, metadata
└── runs/                # run history and logs
```

## Tech Stack

| Layer | Technology |
|---|---|
| Server | FastAPI + uvicorn |
| UI | React + TypeScript + Vite |
| Query engine | DuckDB (embedded) |
| Lakehouse format | Delta Lake via delta-rs |
| File access | fsspec |
| Orchestration | In-process scheduler |
| Versioning | Git (gitpython) |

## Development

```bash
# Run the API server (hot-reload)
uvicorn server.main:app --reload --port 8000

# Run the React dev server (hot-reload, proxies to API)
cd ui
npm run dev
```

## Demo Workspace

A demo workspace is included at `examples/demo-workspace/`. Open it in the UI to see example connections, pipelines, and Bronze/Silver tables.
