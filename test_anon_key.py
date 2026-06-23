import os
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("VITE_SUPABASE_ANON_KEY")  # Oops, maybe this is not set in backend/.env

client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
res = client.table("documents").select("*").eq("name", "__DOCMIND_API_CONFIG__").execute()
print(res.data)
