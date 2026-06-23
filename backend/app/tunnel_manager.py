import re
import subprocess
import time
import os
import sys
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def push_url_to_supabase(url: str):
    """Pushes the tunnel URL to Supabase 'documents' table as a config entry."""
    print(f"Pushing Tunnel URL to Supabase: {url}")
    # Check if config document exists
    res = supabase.table("documents").select("id").eq("name", "__DOCMIND_API_CONFIG__").execute()
    if res.data and len(res.data) > 0:
        doc_id = res.data[0]["id"]
        supabase.table("documents").update({
            "metadata": {"api_url": url}
        }).eq("id", doc_id).execute()
    else:
        supabase.table("documents").insert({
            "name": "__DOCMIND_API_CONFIG__",
            "category": "system",
            "metadata": {"api_url": url}
        }).execute()

def main():
    print("Starting Cloudflare Quick Tunnel...")
    # Start cloudflared in the background
    process = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    url = None
    # Cloudflared outputs the quick tunnel URL to stderr
    while True:
        line = process.stderr.readline()
        if not line:
            break
        print(line.strip())
        # Look for https://[random].trycloudflare.com
        match = re.search(r'(https://[a-zA-Z0-9-]+\.trycloudflare\.com)', line)
        if match:
            url = match.group(1)
            print(f"\n✅ Quick Tunnel Established: {url}\n")
            push_url_to_supabase(url)
            break

    # Keep the tunnel running
    try:
        process.wait()
    except KeyboardInterrupt:
        process.terminate()

if __name__ == "__main__":
    main()
