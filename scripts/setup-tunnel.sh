#!/bin/bash
set -e

# DocMind Auto-Backend + Tunnel Setup
# Starts FastAPI and an auto-updating Cloudflare Quick Tunnel

echo "╔═══════════════════════════════════════════════╗"
echo "║  DocMind — Auto-Backend & Quick Tunnel Setup  ║"
echo "╚═══════════════════════════════════════════════╝"

cd "$(dirname "$0")/../backend"
BACKEND_DIR=$(pwd)

echo ""
echo "► Creating startup script..."
cat << 'EOF' > run_daemon.sh
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
EOF
chmod +x run_daemon.sh

echo "► Installing macOS LaunchAgent..."
PLIST_PATH="$HOME/Library/LaunchAgents/com.docmind.backend.plist"

cat << EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.docmind.backend</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BACKEND_DIR/run_daemon.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$BACKEND_DIR/../logs/fastapi.log</string>
    <key>StandardErrorPath</key>
    <string>$BACKEND_DIR/../logs/fastapi.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

# Restart the service
echo "► Restarting background service..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "✅ Done! FastAPI and Cloudflare are running in the background."
echo "✅ The tunnel URL will be automatically sent to Vercel via Supabase."
echo "► Check logs: tail -f ../logs/fastapi.log"
