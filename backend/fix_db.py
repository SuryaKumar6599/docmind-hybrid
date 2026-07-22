import os
import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# Update all applications that are in error state
url = f"{SUPABASE_URL}/rest/v1/job_applications?status=eq.error"
payload = {
    "status": "pending_processing",
    "error_message": None
}

response = requests.patch(url, headers=headers, json=payload)
print(response.status_code, response.text)
