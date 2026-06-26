-- ============================================================
-- DocMind — FULL SETUP (run this once in Supabase SQL Editor)
-- https://supabase.com/dashboard/project/xsrswffyzrtctinsjpty/sql/new
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- 1. documents
create table if not exists documents (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  category   text not null default 'general',
  metadata   jsonb default '{}',
  created_at timestamptz not null default now()
);

-- 2. document_chunks
create table if not exists document_chunks (
  id          uuid primary key default uuid_generate_v4(),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index int  not null default 0,
  content     text not null,
  embedding   vector(768),
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists dc_doc_idx on document_chunks(document_id);
create index if not exists dc_emb_idx on document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 3. resumes
create table if not exists resumes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           text not null default 'anonymous',
  original_filename text not null,
  storage_path      text not null,
  status            text not null default 'pending_processing',
  document_id       uuid references documents(id),
  markdown_content  text,
  chunk_count       int,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists resumes_user_idx   on resumes(user_id);
create index if not exists resumes_status_idx on resumes(status);

-- 4. job_applications
create table if not exists job_applications (
  id               uuid primary key default uuid_generate_v4(),
  user_id          text not null default 'anonymous',
  resume_id        uuid not null references resumes(id),
  company_name     text not null,
  role             text not null,
  jd_url           text,
  jd_storage_path  text,
  status           text not null default 'to_apply',
  application_date date,
  status_dates     jsonb not null default '{}'::jsonb,
  match_score      int check (match_score between 0 and 100),
  stage1_analysis  jsonb,
  stage2_content   jsonb,
  docx_url         text,
  pdf_url          text,
  notes            text,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists apps_user_idx   on job_applications(user_id);
create index if not exists apps_status_idx on job_applications(status);
create index if not exists apps_resume_idx on job_applications(resume_id);
create index if not exists apps_status_dates_gin_idx on job_applications using gin (status_dates);

-- 5. RPCs
create or replace function match_documents(query_embedding vector(768), match_count int default 5)
returns table (id uuid, document_id uuid, document_name text, chunk_index int, content text, metadata jsonb, similarity float)
language sql stable as $$
  select dc.id, dc.document_id, d.name, dc.chunk_index, dc.content, dc.metadata,
         1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc join documents d on d.id = dc.document_id
  order by dc.embedding <=> query_embedding limit match_count;
$$;

create or replace function match_documents_filtered(query_embedding vector(768), match_count int default 5, filter_category text default null)
returns table (id uuid, document_id uuid, document_name text, chunk_index int, content text, metadata jsonb, similarity float)
language sql stable as $$
  select dc.id, dc.document_id, d.name, dc.chunk_index, dc.content, dc.metadata,
         1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc join documents d on d.id = dc.document_id
  where filter_category is null or d.category = filter_category
  order by dc.embedding <=> query_embedding limit match_count;
$$;

-- 6. updated_at trigger
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create or replace trigger resumes_updated_at
  before update on resumes for each row execute function set_updated_at();
create or replace trigger job_applications_updated_at
  before update on job_applications for each row execute function set_updated_at();

-- 7. RLS (open for dev — no Auth required yet)
alter table documents        enable row level security;
alter table document_chunks  enable row level security;
alter table resumes          enable row level security;
alter table job_applications enable row level security;

create policy "open documents"    on documents        for all using (true) with check (true);
create policy "open chunks"       on document_chunks  for all using (true) with check (true);
create policy "open resumes"      on resumes          for all using (true) with check (true);
create policy "open applications" on job_applications for all using (true) with check (true);

-- 8. Realtime
alter publication supabase_realtime add table resumes;
alter publication supabase_realtime add table job_applications;

-- ============================================================
-- AFTER running this, go to:
-- Storage → New bucket → "resumes"          (private)
-- Storage → New bucket → "job-descriptions" (private)
-- Storage → New bucket → "tailored-resumes" (private)
-- Then run the storage policy block below:
-- ============================================================

-- Storage RLS (run after creating buckets in dashboard)
create policy "open resumes bucket"     on storage.objects for all using (bucket_id = 'resumes')          with check (bucket_id = 'resumes');
create policy "open jd bucket"          on storage.objects for all using (bucket_id = 'job-descriptions') with check (bucket_id = 'job-descriptions');
create policy "open tailored bucket"    on storage.objects for all using (bucket_id = 'tailored-resumes') with check (bucket_id = 'tailored-resumes');
