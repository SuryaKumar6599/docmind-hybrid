# Supabase Setup Guide

## Step 1 — Run the main schema

Go to: https://supabase.com/dashboard/project/xsrswffyzrtctinsjpty/sql/new

Paste and run `schema.sql` (creates tables, RPCs, triggers, Realtime).

## Step 2 — Create Storage buckets (DASHBOARD METHOD — most reliable)

Go to: https://supabase.com/dashboard/project/xsrswffyzrtctinsjpty/storage/buckets

Create 3 buckets (all **private**):
1. `resumes`
2. `job-descriptions`  
3. `tailored-resumes`

## Step 3 — Run open RLS policies (for dev without Auth)

Paste and run in SQL Editor:

```sql
-- Open RLS for dev (no Supabase Auth yet)
create policy "Dev open resumes"         on resumes          for all using (true) with check (true);
create policy "Dev open applications"    on job_applications for all using (true) with check (true);
create policy "Dev open documents"       on documents        for all using (true) with check (true);
create policy "Dev open chunks"          on document_chunks  for all using (true) with check (true);

-- Storage bucket policies
create policy "Allow all resumes storage"          on storage.objects for all using (bucket_id = 'resumes')          with check (bucket_id = 'resumes');
create policy "Allow all jd storage"               on storage.objects for all using (bucket_id = 'job-descriptions') with check (bucket_id = 'job-descriptions');
create policy "Allow all tailored-resumes storage" on storage.objects for all using (bucket_id = 'tailored-resumes') with check (bucket_id = 'tailored-resumes');
```

## Step 4 — Start the local FastAPI worker (on your Mac)

```bash
cd backend
pip install -r requirements.txt
# Create backend/.env from .env.example and fill in your values
uvicorn app.main:app --reload --port 8000 &
python -m app.worker
```

## Step 5 — Expose via Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:8000
# Paste the https://xxx.trycloudflare.com URL into VITE_DOCMIND_API_URL
```
