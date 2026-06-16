#!/bin/bash
# Generic startup script for SoverData container
export PYTHONPATH=/app:$PYTHONPATH
cd /app

# Workspaces root lives in /home (persistent across deploys via WEBSITES_ENABLE_APP_SERVICE_STORAGE=true)
export SOVERDATA_WORKSPACES_ROOT="${SOVERDATA_WORKSPACES_ROOT:-/home/workspaces}"
mkdir -p "$SOVERDATA_WORKSPACES_ROOT"

exec python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --workers 1
