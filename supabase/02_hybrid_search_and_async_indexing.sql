-- DocMind Hybrid: Phase 2 Improvements
-- Run this in your Supabase SQL Editor to apply updates.

-- ============================================================
-- 1. Hybrid Search (pgvector + BM25 via RRF)
-- ============================================================

-- Add tsvector column for Full Text Search (BM25)
ALTER TABLE document_chunks 
ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Create GIN index for fast full-text search
CREATE INDEX document_chunks_fts_idx ON document_chunks USING GIN(fts);

-- Hybrid search RPC using Reciprocal Rank Fusion (RRF)
CREATE OR REPLACE FUNCTION match_documents_hybrid(
  query_text text,
  query_embedding vector(768),
  match_count int default 5,
  filter_category text default null,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  rrf_k int default 60
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  document_name text,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE AS $$
WITH semantic_search AS (
  SELECT
    dc.id,
    RANK() OVER (ORDER BY dc.embedding <=> query_embedding) as rank,
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE (filter_category IS NULL OR d.category = filter_category)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count * 2
),
keyword_search AS (
  SELECT
    dc.id,
    RANK() OVER (ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) DESC) as rank
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE (filter_category IS NULL OR d.category = filter_category)
    AND dc.fts @@ websearch_to_tsquery('english', query_text)
  ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) DESC
  LIMIT match_count * 2
),
rrf_results AS (
  SELECT
    COALESCE(s.id, k.id) as chunk_id,
    COALESCE(1.0 / (rrf_k + s.rank), 0.0) * semantic_weight +
    COALESCE(1.0 / (rrf_k + k.rank), 0.0) * full_text_weight as score,
    s.similarity
  FROM semantic_search s
  FULL OUTER JOIN keyword_search k ON s.id = k.id
  ORDER BY score DESC
  LIMIT match_count
)
SELECT
  dc.id,
  dc.document_id,
  d.name as document_name,
  dc.chunk_index,
  dc.content,
  dc.metadata,
  COALESCE(r.similarity, 0.0) as similarity
FROM rrf_results r
JOIN document_chunks dc ON dc.id = r.chunk_id
JOIN documents d ON d.id = dc.document_id
ORDER BY r.score DESC;
$$;

-- ============================================================
-- 2. Async Indexing (Worker Pattern)
-- ============================================================

-- Add background processing tracking to existing documents table
ALTER TABLE documents 
ADD COLUMN status text NOT NULL DEFAULT 'ready',
ADD COLUMN storage_path text,
ADD COLUMN chunk_count int,
ADD COLUMN error_message text;

-- Bucket for uploaded search documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('search-documents', 'search-documents', false)
ON CONFLICT DO NOTHING;

-- RLS for documents (assuming anonymous/public for local use, or authenticated)
-- The UI currently doesn't use auth, so we'll enable public access for the bucket locally
CREATE POLICY "Public read search-documents" ON storage.objects FOR SELECT USING (bucket_id = 'search-documents');
CREATE POLICY "Public insert search-documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'search-documents');

-- Enable Realtime for documents table so the UI can listen for 'ready'
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
