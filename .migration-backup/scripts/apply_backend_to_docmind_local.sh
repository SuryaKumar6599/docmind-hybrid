#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-}"
if [ -z "$TARGET_DIR" ]; then
  echo "Usage: ./scripts/apply_backend_to_docmind_local.sh /path/to/DocMind-Local"
  exit 1
fi

mkdir -p "$TARGET_DIR/api"
mkdir -p "$TARGET_DIR/tests"

mkdir -p "$TARGET_DIR/app"
cp -R backend/app/. "$TARGET_DIR/app/"
cp backend/requirements.txt "$TARGET_DIR/requirements.txt"
cp backend/.env.example "$TARGET_DIR/.env.example"
cp -R backend/tests/. "$TARGET_DIR/tests/"
cp supabase/schema.sql "$TARGET_DIR/supabase_schema.sql"

cat > "$TARGET_DIR/api/main.py" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app
PY

echo "Updated $TARGET_DIR"
echo "Next:"
echo "  cd $TARGET_DIR"
echo "  cp .env.example .env"
echo "  pip install -r requirements.txt"
echo "  uvicorn api.main:app --reload --port 8000"
