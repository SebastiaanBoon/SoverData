#!/bin/bash
# Generic startup script for SoverData container
export PYTHONPATH=/app:$PYTHONPATH
cd /app

# Persist workspace in /home so it survives deploys (requires WEBSITES_ENABLE_APP_SERVICE_STORAGE=true)
WORKSPACE_PATH="${SOVERDATA_WORKSPACE:-/home/workspace}"
if [ ! -f "$WORKSPACE_PATH/workspace.yaml" ]; then
    echo "Initializing workspace at $WORKSPACE_PATH from demo..."
    mkdir -p "$WORKSPACE_PATH"
    cp -rn /app/examples/demo-workspace/. "$WORKSPACE_PATH/"
fi
export SOVERDATA_WORKSPACE="$WORKSPACE_PATH"

exec python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --workers 1
