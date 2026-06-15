#!/bin/bash
export PYTHONPATH=/home/site/wwwroot/__oryx_packages__:$PYTHONPATH
export PATH=/home/site/wwwroot/__oryx_packages__/bin:$PATH
cd /home/site/wwwroot
exec python -m uvicorn server.api.main:app --host 0.0.0.0 --port 8000 --workers 1
