-- DocMind Hybrid — Supabase SQL Schema
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query)
-- Requires: pgvector extension (enabled by default on Supabase)

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists vector;


-- ============================================================
-- 1. documents — general document index (RAG chunks source)
-- ============================================================
create table if not exists documents (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  category    text not null default 'general',  -- 'general' | 'resume' | 'portfolio'
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. document_chunks — vector store
-- ============================================================
create table if not exists document_chunks (
  id           uuid primary key default uuid_generate_v4(),
  document_id  uuid not null references documents(id) on delete cascade,
  chunk_index  int  not null default 0,
  content      text not null,
  embedding    vector(768),          -- nomic-embed-text output dimension
  metadata     jsonb default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists document_chunks_document_id_idx
  on document_chunks(document_id);

create index if not exists document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- 3. resumes — base resume storage per user
-- ============================================================
create table if not exists resumes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null,
  original_filename text not null,
  storage_path      text not null,          -- path inside 'resumes' Supabase bucket
  status            text not null default 'pending_processing',
  --   pending_processing | processing | ready | error
  document_id       uuid references documents(id),
  markdown_content  text,                   -- cleaned markdown (set by worker)
  chunk_count       int,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists resumes_user_id_idx on resumes(user_id);
create index if not exists resumes_status_idx  on resumes(status);

-- ============================================================
-- 4. job_applications — tracker + tailoring pipeline state
-- ============================================================
create table if not exists job_applications (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null,
  resume_id        uuid not null references resumes(id),
  company_name     text not null,
  role             text not null,
  jd_url           text,                         -- external URL of the JD (optional)
  jd_storage_path  text,                         -- path inside 'job-descriptions' bucket
  status           text not null default 'to_apply',
  --   to_apply | pending_processing | processing
  --   stage1_complete | ready | error
  --   applied | interview | offer | rejected
  application_date date,
  status_dates     jsonb not null default '{}'::jsonb,
  match_score      int check (match_score between 0 and 100),
  stage1_analysis  jsonb,                        -- JobMatchAnalysis output
  stage2_content   jsonb,                        -- TailoredContent output
  docx_url         text,                         -- public URL of tailored DOCX
  pdf_url          text,                         -- public URL of tailored PDF
  notes            text,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists job_apps_user_id_idx  on job_applications(user_id);
create index if not exists job_apps_status_idx   on job_applications(status);
create index if not exists job_apps_resume_id_idx on job_applications(resume_id);
create index if not exists job_apps_status_dates_gin_idx on job_applications using gin (status_dates);

-- ============================================================
-- 5. RPC: match_documents (cross-document semantic search)
-- ============================================================
create or replace function match_documents(
  query_embedding vector(768),
  match_count     int default 5
)
returns table (
  id            uuid,
  document_id   uuid,
  document_name text,
  chunk_index   int,
  content       text,
  metadata      jsonb,
  similarity    float
)
language sql stable as $$
  select
    dc.id,
    dc.document_id,
    d.name as document_name,
    dc.chunk_index,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  join documents d on d.id = dc.document_id
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- 6. RPC: match_documents_filtered (category-scoped search)
-- ============================================================
create or replace function match_documents_filtered(
  query_embedding   vector(768),
  match_count       int default 5,
  filter_category   text default null
)
returns table (
  id            uuid,
  document_id   uuid,
  document_name text,
  chunk_index   int,
  content       text,
  metadata      jsonb,
  similarity    float
)
language sql stable as $$
  select
    dc.id,
    dc.document_id,
    d.name as document_name,
    dc.chunk_index,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where filter_category is null or d.category = filter_category
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- 7. updated_at trigger (auto-update on row change)
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger resumes_updated_at
  before update on resumes
  for each row execute function set_updated_at();

create or replace trigger job_applications_updated_at
  before update on job_applications
  for each row execute function set_updated_at();

-- ============================================================
-- 8. Supabase Storage buckets + RLS
--    Run each block separately in the Supabase dashboard if needed
-- ============================================================

-- Bucket: resumes (private — only service role can read/write)
insert into storage.buckets (id, name, public)
  values ('resumes', 'resumes', false)
  on conflict do nothing;

-- Bucket: job-descriptions (private)
insert into storage.buckets (id, name, public)
  values ('job-descriptions', 'job-descriptions', false)
  on conflict do nothing;

-- Bucket: tailored-resumes (private — users download via signed URL)
insert into storage.buckets (id, name, public)
  values ('tailored-resumes', 'tailored-resumes', false)
  on conflict do nothing;

-- RLS: resumes table — users see only their own rows
alter table resumes enable row level security;
create policy "Users see own resumes"
  on resumes for all
  using (auth.uid()::text = user_id::text);

-- RLS: job_applications table
alter table job_applications enable row level security;
create policy "Users see own applications"
  on job_applications for all
  using (auth.uid()::text = user_id::text);

-- RLS: documents — readable by authenticated users
alter table documents enable row level security;
create policy "Authenticated users can read documents"
  on documents for select
  using (auth.role() = 'authenticated');

-- RLS: document_chunks — readable by authenticated users
alter table document_chunks enable row level security;
create policy "Authenticated users can read chunks"
  on document_chunks for select
  using (auth.role() = 'authenticated');

-- Enable Supabase Realtime on job_applications (for live UI updates)
alter publication supabase_realtime add table job_applications;
alter publication supabase_realtime add table resumes;
