#!/usr/bin/env bash
set -euo pipefail

cd /app
export PYTHONPATH="/app:${PYTHONPATH:-}"

export SOVERDATA_WORKSPACES_ROOT="${SOVERDATA_WORKSPACES_ROOT:-/home/workspaces}"
mkdir -p "$SOVERDATA_WORKSPACES_ROOT"

exec python -m uvicorn server.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers 1
