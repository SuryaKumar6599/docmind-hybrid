create extension if not exists vector;

create table if not exists documents (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

alter table documents enable row level security;

create table if not exists document_chunks (
  id uuid default gen_random_uuid() primary key,
  document_id uuid references documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768) not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

alter table document_chunks enable row level security;

-- Security posture:
-- The browser should call only your local FastAPI backend, never these tables.
-- The local backend uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Do not add anon/authenticated policies unless you intentionally want direct
-- client access to document text and embeddings.
revoke all on table documents from anon, authenticated;
revoke all on table document_chunks from anon, authenticated;
grant all on table documents to service_role;
grant all on table document_chunks to service_role;

create index if not exists document_chunks_embedding_idx
on document_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

create or replace function match_documents (
  query_embedding vector(768),
  match_count int default 5
) returns table (
  id uuid,
  document_id uuid,
  document_name text,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
set search_path = public
as $$
  select
    document_chunks.id,
    document_chunks.document_id,
    documents.name as document_name,
    document_chunks.chunk_index,
    document_chunks.content,
    document_chunks.metadata,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  join documents on documents.id = document_chunks.document_id
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function match_documents(vector, int) from public, anon, authenticated;
grant execute on function match_documents(vector, int) to service_role;
