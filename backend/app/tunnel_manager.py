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

if "your-project-ref" in SUPABASE_URL or "your-service-role-key-here" in SUPABASE_KEY:
    print("⚠️  WARNING: Dummy Supabase credentials detected in .env!")
    print("⚠️  Tunnel will start, but URL will NOT be pushed to Supabase.")
    supabase = None
else:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def push_url_to_supabase(url: str):
    """Pushes the tunnel URL to Supabase and writes it locally for frontend dev."""
    
    # 1. Always write locally for seamless local development
    env_local_path = os.path.join(os.path.dirname(__file__), "..", "..", "artifacts", "docmind", ".env.local")
    try:
        os.makedirs(os.path.dirname(env_local_path), exist_ok=True)
        # Read existing content to preserve other vars
        content = ""
        if os.path.exists(env_local_path):
            with open(env_local_path, "r") as f:
                content = f.read()
        
        # Remove old API URL if present
        lines = [line for line in content.splitlines() if not line.startswith("VITE_DOCMIND_API_URL=")]
        lines.append(f"VITE_DOCMIND_API_URL={url}")
        
        with open(env_local_path, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"✅ Successfully wrote Tunnel URL to {env_local_path} (Bypassing Supabase for local dev!)")
    except Exception as e:
        print(f"⚠️  Could not write to .env.local: {e}")

    # 2. Push to Supabase for deployed Vercel app
    if not supabase:
        print("⚠️  Skipping Supabase upload due to dummy credentials.")
        return

    print(f"Pushing Tunnel URL to Supabase: {url}")
    bucket_name = "docmind-config"
    file_name = "api_url.json"
    
    # Ensure bucket exists and is public
    try:
        supabase.storage.create_bucket(bucket_name, options={"public": True})
    except Exception:
        pass # Bucket might already exist
        
    try:
        supabase.storage.from_(bucket_name).remove([file_name])
    except Exception:
        pass
        
    import json
    data = json.dumps({"api_url": url}).encode("utf-8")
    supabase.storage.from_(bucket_name).upload(file_name, data)
    print("✅ Successfully pushed to public config bucket!")

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
