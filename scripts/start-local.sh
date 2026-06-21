#!/usr/bin/env bash
# Start all local DocMind backend services and expose them via a static URL.

# Ensure we are in the project root
cd "$(dirname "$0")/.."

echo "🚀 Starting DocMind Local Services..."

# 1. Start Uvicorn backend in the background
echo "Starting FastAPI backend (localhost:8000)..."
cd backend
source .venv/bin/activate
uvicorn app.main:app --port 8000 --reload &
UVICORN_PID=$!
cd ..

# 2. Start Worker in the background
echo "Starting Supabase polling worker..."
cd backend
source .venv/bin/activate
python -m app.worker &
WORKER_PID=$!
cd ..

# 3. Expose via Cloudflared or ngrok
echo "Starting Cloudflared/ngrok tunnel..."
echo "------------------------------------------------------"
echo "To use a persistent static URL instead of losing it on restart:"
echo ""
echo "A. Using ngrok (Free tier):"
echo "   ngrok http --domain=YOUR-STATIC-DOMAIN.ngrok-free.app 8000"
echo ""
echo "B. Using Cloudflare Tunnel (Free):"
echo "   cloudflared tunnel run docmind-local"
echo "------------------------------------------------------"
echo ""

# Fallback: run a temporary cloudflared tunnel if the user hasn't modified this script
cloudflared tunnel --url http://localhost:8000

# Cleanup on exit
function cleanup {
  echo "Stopping services..."
  kill $UVICORN_PID
  kill $WORKER_PID
  exit
}
trap cleanup EXIT
