#!/usr/bin/env bash
set -euo pipefail

# Support both the Docker image path and Azure App Service code-deploy path.
if [ -f /app/server/api/main.py ]; then
    APP_ROOT=/app
elif [ -f /home/site/wwwroot/server/api/main.py ]; then
    APP_ROOT=/home/site/wwwroot
else
    APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

export PYTHONPATH="${APP_ROOT}:${PYTHONPATH:-}"
cd "$APP_ROOT"

PORT="${PORT:-8000}"
exec python -m uvicorn server.api.main:app --host 0.0.0.0 --port "$PORT" --workers 1
