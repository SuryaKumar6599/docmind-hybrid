import os
from dotenv import load_dotenv
load_dotenv("backend/.env")
from supabase import create_client
c = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

try:
    c.storage.create_bucket("docmind-config", options={"public": True})
except Exception as e:
    pass

try:
    c.storage.from_("docmind-config").remove(["api_url.json"])
except:
    pass

res = c.storage.from_("docmind-config").upload("api_url.json", b'{"api_url": "https://test.trycloudflare.com"}')
print(res)
