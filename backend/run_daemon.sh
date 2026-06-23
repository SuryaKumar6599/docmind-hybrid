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

if [[ -f "$BACKEND_DIR/.venv/bin/activate" ]]; then
  # Preferred project virtualenv.
  source "$BACKEND_DIR/.venv/bin/activate"
elif [[ -f "$BACKEND_DIR/venv/bin/activate" ]]; then
  # Backward-compatible fallback for older local setup.
  source "$BACKEND_DIR/venv/bin/activate"
else
  echo "No Python virtualenv found. Create one with:"
  echo "  cd $BACKEND_DIR && python3 -m venv .venv && source .venv/bin/activate && python -m pip install -r requirements.txt"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "Missing $BACKEND_DIR/.env. Copy .env.example and fill Supabase values first."
  exit 1
fi

PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT

echo "[$(date)] Starting DocMind backend stack from $BACKEND_DIR"

echo "Starting FastAPI on http://127.0.0.1:$PORT ..."
python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >> "$LOG_DIR/backend.log" 2>&1 &
PIDS+=("$!")

echo "Starting Worker ..."
python -m app.worker >> "$LOG_DIR/worker.log" 2>&1 &
PIDS+=("$!")

echo "Starting Tunnel Manager ..."
python -m app.tunnel_manager >> "$LOG_DIR/tunnel.log" 2>&1 &
PIDS+=("$!")

while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[$(date)] A DocMind process exited; stopping the stack so launchd can restart it."
      cleanup
      exit 1
    fi
  done
  sleep 5
done
