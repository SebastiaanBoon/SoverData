#!/usr/bin/env bash
set -euo pipefail

cd /app
export PYTHONPATH="/app:${PYTHONPATH:-}"

exec python -m uvicorn server.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers 1
