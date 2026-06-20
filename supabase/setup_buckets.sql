-- ============================================================
-- DocMind: Storage Buckets + Policies
-- Run this in Supabase SQL Editor AFTER schema.sql
-- ============================================================

-- 1. Create buckets (must be done via SQL with service_role or dashboard)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('resumes',          'resumes',          false, 10485760,  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword']),
    ('job-descriptions', 'job-descriptions', false, 10485760,  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),
    ('tailored-resumes', 'tailored-resumes', false, 10485760,  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
  on conflict (id) do nothing;

-- 2. Storage RLS: allow anyone to upload/read/delete (no auth for now)
--    Replace these with auth.uid()-scoped policies once you add Supabase Auth.

-- resumes bucket
create policy "Allow all on resumes bucket"
  on storage.objects for all
  using (bucket_id = 'resumes')
  with check (bucket_id = 'resumes');

-- job-descriptions bucket
create policy "Allow all on job-descriptions bucket"
  on storage.objects for all
  using (bucket_id = 'job-descriptions')
  with check (bucket_id = 'job-descriptions');

-- tailored-resumes bucket
create policy "Allow all on tailored-resumes bucket"
  on storage.objects for all
  using (bucket_id = 'tailored-resumes')
  with check (bucket_id = 'tailored-resumes');

-- 3. Table RLS: open policies for dev (no auth)
--    resumes
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='resumes' and policyname='Dev open resumes'
  ) then
    execute 'create policy "Dev open resumes" on resumes for all using (true) with check (true)';
  end if;
end $$;

--    job_applications
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='job_applications' and policyname='Dev open applications'
  ) then
    execute 'create policy "Dev open applications" on job_applications for all using (true) with check (true)';
  end if;
end $$;

--    documents
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='documents' and policyname='Dev open documents'
  ) then
    execute 'create policy "Dev open documents" on documents for all using (true) with check (true)';
  end if;
end $$;

--    document_chunks
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='document_chunks' and policyname='Dev open chunks'
  ) then
    execute 'create policy "Dev open chunks" on document_chunks for all using (true) with check (true)';
  end if;
end $$;
