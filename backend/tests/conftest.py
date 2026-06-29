import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# app.config.get_settings() requires these to be set even for tests that
# never touch Supabase for real — set dummy values once, here, so every
# test module can import app.api/app.main without repeating this.
os.environ.setdefault("SUPABASE_URL", "https://dummy.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy-key-for-tests")
