#!/bin/bash
# Activated by macOS launchd
cd "$(dirname "$0")"
source venv/bin/activate

# 1. Start FastAPI in the background
echo "Starting FastAPI..."
uvicorn app.api:app --host 127.0.0.1 --port 8000 &
FASTAPI_PID=$!

# 2. Start Tunnel Manager (which uploads URL to Supabase)
echo "Starting Tunnel Manager..."
python -m app.tunnel_manager &
TUNNEL_PID=$!

# Wait for processes
wait $FASTAPI_PID
wait $TUNNEL_PID
