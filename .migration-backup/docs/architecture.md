# Architecture

DocMind Hybrid has three runtime layers.

## 1. Web UI

`web/` is a Next.js App Router project intended for Vercel. It never talks directly to Ollama or Supabase. It sends uploads and questions to the local FastAPI backend URL configured by `NEXT_PUBLIC_DOCMIND_API_URL`.

## 2. Local AI Backend

`backend/app/` runs on your Mac.

Responsibilities:

- Convert uploaded files to Markdown with MarkItDown.
- Chunk document text.
- Generate embeddings with local Ollama `nomic-embed-text`.
- Retrieve vector matches from Supabase.
- Generate cited answers with local Ollama `qwen2.5:7b`.

Important modules:

- `config.py`: typed environment settings.
- `document_processing.py`: conversion, cleanup, chunking.
- `ollama.py`: embedding and chat client.
- `supabase_store.py`: all Supabase persistence and vector search.
- `rag.py`: grounded answer generation and citation validation.
- `api.py`: FastAPI endpoints.

## 3. Supabase

Supabase hosts Postgres with `pgvector`.

Tables:

- `documents`: one row per uploaded document.
- `document_chunks`: one row per chunk, including a 768-dimensional embedding.

Function:

- `match_documents(query_embedding, match_count)`: cosine similarity search over stored chunks.

## Privacy Boundary

Document contents and embeddings are stored in Supabase. LLM inference and embedding generation stay on your Mac via Ollama. If you need fully offline storage, replace Supabase with local Postgres + pgvector using the same SQL schema.
