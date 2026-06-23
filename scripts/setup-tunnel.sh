#!/usr/bin/env bash
# One-time installer for DocMind local backend auto-start.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
LOG_DIR="$PROJECT_DIR/logs"
PLIST_PATH="$HOME/Library/LaunchAgents/com.docmind.backend.plist"
LABEL="com.docmind.backend"
UID_VALUE="$(id -u)"

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

echo "DocMind auto-start setup"
echo "Project: $PROJECT_DIR"

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "Missing backend/.env. Create it first:"
  echo "  cp $BACKEND_DIR/.env.example $BACKEND_DIR/.env"
  echo "Then fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  exit 1
fi

if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  echo "Creating backend virtualenv at backend/.venv ..."
  python3 -m venv "$BACKEND_DIR/.venv"
fi

echo "Installing backend Python dependencies ..."
"$BACKEND_DIR/.venv/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"

chmod +x "$BACKEND_DIR/run_daemon.sh"
xattr -d com.apple.quarantine "$BACKEND_DIR/run_daemon.sh" 2>/dev/null || true
xattr -d com.apple.quarantine "$PROJECT_DIR/scripts/setup-tunnel.sh" 2>/dev/null || true

if [[ "$PROJECT_DIR" == "$HOME/Documents/"* ]]; then
  echo ""
  echo "Note: this project is inside Documents. If launchd logs 'Operation not permitted',"
  echo "move the repo to a non-protected path like $HOME/Projects/docmind-hybrid and rerun this setup."
  echo ""
fi

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$BACKEND_DIR/run_daemon.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$BACKEND_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/daemon.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

echo "Installing LaunchAgent ..."
launchctl bootout "gui/$UID_VALUE" "$PLIST_PATH" 2>/dev/null || true
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH" 2>/dev/null || launchctl load -w "$PLIST_PATH"
launchctl enable "gui/$UID_VALUE/$LABEL" 2>/dev/null || true
launchctl kickstart -k "gui/$UID_VALUE/$LABEL" 2>/dev/null || true

echo ""
echo "Done. DocMind backend, worker, and tunnel manager are installed."
echo "Logs:"
echo "  tail -f $LOG_DIR/daemon.log"
echo "  tail -f $LOG_DIR/backend.log"
echo "  tail -f $LOG_DIR/worker.log"
echo "  tail -f $LOG_DIR/tunnel.log"
echo ""
echo "Health check:"
echo "  curl http://127.0.0.1:8000/health"
