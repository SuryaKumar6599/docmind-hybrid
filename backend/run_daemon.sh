#!/usr/bin/env bash
# Starts the complete local DocMind backend stack.
# Safe to run from launchd or manually from any working directory.

set -u

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
PORT="${DOCMIND_PORT:-8000}"

mkdir -p "$LOG_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PYTHONPATH="$BACKEND_DIR${PYTHONPATH:+:$PYTHONPATH}"

cd "$BACKEND_DIR" || exit 1

if [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  # Preferred project virtualenv.
  PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
elif [[ -x "$BACKEND_DIR/venv/bin/python" ]]; then
  # Backward-compatible fallback for older local setup.
  PYTHON_BIN="$BACKEND_DIR/venv/bin/python"
else
  echo "No Python virtualenv found. Create one with:"
  echo "  cd $BACKEND_DIR && python3 -m venv .venv && source .venv/bin/activate && python -m pip install -r requirements.txt"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "Missing $BACKEND_DIR/.env. Copy .env.example and fill Supabase values first."
  exit 1
fi

FASTAPI_PID=""
WORKER_PID=""
TUNNEL_PID=""
TUNNEL_RESTART_COUNT=0
MAX_TUNNEL_RESTARTS=10 # if the tunnel is this flaky, give up and let launchd restart everything

cleanup() {
  for pid in "$FASTAPI_PID" "$WORKER_PID" "$TUNNEL_PID"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT

start_fastapi() {
  echo "Starting FastAPI on http://127.0.0.1:$PORT ..."
  "$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >> "$LOG_DIR/backend.log" 2>&1 &
  FASTAPI_PID="$!"
}

start_worker() {
  echo "Starting Worker ..."
  "$PYTHON_BIN" -m app.worker >> "$LOG_DIR/worker.log" 2>&1 &
  WORKER_PID="$!"
}

start_tunnel() {
  echo "Starting Tunnel Manager ..."
  "$PYTHON_BIN" -m app.tunnel_manager >> "$LOG_DIR/tunnel.log" 2>&1 &
  TUNNEL_PID="$!"
}

print_startup_summary() {
  # Give tunnel_manager a moment to mint a URL and push it to Supabase
  # before reporting — both happen within a few seconds of startup.
  sleep 6
  local tunnel_url supabase_result
  tunnel_url=$(grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | tail -1)
  if grep -q "Successfully pushed to public config bucket" "$LOG_DIR/tunnel.log" 2>/dev/null; then
    supabase_result="pushed to docmind-config bucket"
  elif grep -q "Skipping Supabase upload" "$LOG_DIR/tunnel.log" 2>/dev/null; then
    supabase_result="skipped (no Supabase credentials in .env)"
  else
    supabase_result="not confirmed yet — check $LOG_DIR/tunnel.log"
  fi
  echo "----------------------------------------------------------------"
  echo "DocMind backend startup summary"
  echo "  Backend URL:    http://127.0.0.1:$PORT"
  echo "  Tunnel URL:     ${tunnel_url:-not found yet — check $LOG_DIR/tunnel.log}"
  echo "  Supabase write: $supabase_result"
  echo "----------------------------------------------------------------"
}

echo "[$(date)] Starting DocMind backend stack from $BACKEND_DIR"
echo "Using Python: $PYTHON_BIN"

start_fastapi
start_worker
start_tunnel
print_startup_summary

while true; do
  sleep 5

  if ! kill -0 "$FASTAPI_PID" 2>/dev/null || ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[$(date)] FastAPI or worker exited; stopping the stack so launchd can restart it."
    cleanup
    exit 1
  fi

  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    TUNNEL_RESTART_COUNT=$((TUNNEL_RESTART_COUNT + 1))
    if (( TUNNEL_RESTART_COUNT > MAX_TUNNEL_RESTARTS )); then
      echo "[$(date)] Tunnel Manager has crashed $TUNNEL_RESTART_COUNT times; stopping the stack so launchd can restart it."
      cleanup
      exit 1
    fi
    echo "[$(date)] Tunnel Manager exited (restart #$TUNNEL_RESTART_COUNT) — FastAPI and worker stay up. Restarting it in 3s..."
    sleep 3
    start_tunnel
  fi
done
