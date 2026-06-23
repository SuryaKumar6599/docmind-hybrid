#!/usr/bin/env bash
# Quick health/status view for the local DocMind stack.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.docmind.backend"

echo "LaunchAgent:"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
  && echo "  loaded: yes" \
  || echo "  loaded: no"

echo ""
echo "Local FastAPI:"
curl -fsS http://127.0.0.1:8000/health 2>/dev/null \
  || echo "  not reachable at http://127.0.0.1:8000/health"

echo ""
echo "Latest tunnel:"
if [[ -f "$PROJECT_DIR/logs/tunnel.log" ]]; then
  grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.com' "$PROJECT_DIR/logs/tunnel.log" | tail -1 \
    || echo "  no tunnel URL found yet"
else
  echo "  no tunnel log found"
fi

echo ""
echo "Useful logs:"
echo "  tail -f $PROJECT_DIR/logs/daemon.log"
echo "  tail -f $PROJECT_DIR/logs/backend.log"
echo "  tail -f $PROJECT_DIR/logs/worker.log"
echo "  tail -f $PROJECT_DIR/logs/tunnel.log"
