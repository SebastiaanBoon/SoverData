#!/bin/bash
# Generic startup script for SoverData container
export PYTHONPATH=/app:$PYTHONPATH
cd /app
exec python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --workers 1
