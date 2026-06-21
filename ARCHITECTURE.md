# DocMind — Architecture, Tech Stack & Roadmap

## Overview

DocMind is a **privacy-first, hybrid AI document intelligence platform**. It combines a cloud-hosted Next.js frontend (Vercel) with a local-machine FastAPI backend that runs all LLM inference privately via Ollama — no data leaves your machine.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        CLOUD TIER                            │
│                                                              │
│   ┌─────────────────┐       ┌──────────────────────────┐    │
│   │  React Frontend  │       │      Supabase            │    │
│   │  (Vercel CDN)    │◄─────►│  PostgreSQL + pgvector   │    │
│   │                  │       │  Storage (PDF/DOCX/imgs)  │    │
│   │  · Search page   │       │  Realtime subscriptions  │    │
│   │  · Resumes page  │       └──────────────────────────┘    │
│   │  · Tracker page  │                                       │
│   │  · Convert page  │                                       │
│   └────────┬─────────┘                                       │
│            │ HTTPS / CORS                                    │
└────────────┼────────────────────────────────────────────────-┘
             │ Cloudflare Tunnel (ngrok-style, no port forward)
┌────────────┼─────────────────────────────────────────────────┐
│            ▼            LOCAL MACHINE TIER                    │
│   ┌────────────────────────────────────────┐                 │
│   │         FastAPI Backend (Uvicorn)       │                 │
│   │         localhost:8000                 │                 │
│   │                                        │                 │
│   │  Routes:                               │                 │
│   │  POST /index      → chunk+embed+store  │                 │
│   │  POST /ask        → RAG answer         │                 │
│   │  POST /convert    → Markdown export    │                 │
│   │  POST /extract-skills → gap analysis   │                 │
│   │  GET  /health     → status check       │                 │
│   └───────────────┬────────────────────────┘                 │
│                   │                                          │
│       ┌───────────┼───────────────┐                          │
│       ▼           ▼               ▼                          │
│  ┌─────────┐ ┌─────────┐  ┌────────────┐                    │
│  │ Ollama  │ │ PyMuPDF │  │ MarkItDown │                    │
│  │ Server  │ │ (fitz)  │  │ (MS)       │                    │
│  │         │ │         │  │            │                    │
│  │ · qwen2.5:7b (chat) │  │ PDF/DOCX   │                    │
│  │ · qwen2.5vl:7b (OCR)│  │ PPTX/XLSX  │                    │
│  │ · nomic-embed-text  │  │ HTML/MD    │                    │
│  └─────────┘ └─────────┘  └────────────┘                    │
│                                                              │
│   ┌────────────────────────────────────────┐                 │
│   │   Background Worker (python -m worker) │                 │
│   │   · Polls Supabase every 10s           │                 │
│   │   · Processes pending_processing rows  │                 │
│   │   · Runs 3-stage resume tailoring      │                 │
│   └────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Document Search (RAG)
```
User uploads doc → /index endpoint
  → DocumentProcessor.convert_to_markdown()
      ├── Image file?     → Ollama vision_ocr (qwen2.5vl:7b)
      ├── Scanned PDF?    → PyMuPDF render pages → vision_ocr
      └── Normal doc?     → MarkItDown (pdfminer/python-docx)
  → chunk_text() — paragraph+sentence aware splitting (800 char chunks, 100 overlap)
  → OllamaClient.embedding() — nomic-embed-text (768-dim vectors)
  → SupabaseVectorStore.insert_chunks() — stored in pgvector

User asks question → /ask endpoint
  → embedding(question) → match_documents_filtered(category="general")
  → LocalRAG.answer() — instructor-enforced JSON, hallucination-stripped
  → Response with grounded answer + validated citations
```

### Resume Tailoring Pipeline (3 stages)
```
User uploads resume → Supabase Storage → row: status=pending_processing
  ↓ Worker polls Supabase
Stage 1 (Analytical):
  → DocumentProcessor → MarkItDown → chunk → embed → store (category=resume)
  → Instructor + qwen2.5:7b → JobMatchAnalysis schema
  → Gap analysis: missing_keywords, matched_skills, match_score, core_highlights

Stage 2 (Creative rewrite):
  → qwen2.5:7b → TailoredContent schema
  → tailored_summary, rewritten_bullets, skills_to_add, cover_letter_opening

Stage 3 (Document generation — NO LLM):
  → python-docx renders DOCX from TailoredContent
  → pandoc (optional) converts DOCX → PDF
  → Uploaded to Supabase Storage → public URL returned
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18 + TypeScript | UI framework |
| **Frontend Build** | Vite 7 | Dev server + production bundler |
| **Frontend Styling** | Tailwind CSS | Utility-first design system |
| **Frontend Icons** | Lucide React | Consistent icon set |
| **CDN / Hosting** | Vercel | Global edge deployment |
| **Database** | Supabase (PostgreSQL) | Persistent storage |
| **Vector Search** | pgvector (Supabase) | Semantic search via embeddings |
| **Realtime** | Supabase Realtime | Live status updates (websocket) |
| **File Storage** | Supabase Storage | PDF/DOCX/image hosting |
| **Backend** | FastAPI + Uvicorn | High-performance async API |
| **LLM Runtime** | Ollama | Local private model serving |
| **Chat LLM** | Qwen2.5:7b | Document Q&A + resume tailoring |
| **Vision LLM** | Qwen2.5-VL:7b | OCR for images + scanned PDFs |
| **Embeddings** | nomic-embed-text | 768-dim semantic vectors |
| **Structured Output** | instructor + Pydantic v2 | Guardrailed JSON LLM responses |
| **Document Conversion** | Microsoft MarkItDown | PDF/DOCX/PPTX → Markdown |
| **Scanned PDF OCR** | PyMuPDF (fitz) | Page rendering for vision OCR |
| **Token Counting** | tiktoken | Context budget management |
| **Text Compression** | LLMLingua (optional) | Token-budget enforcement |
| **Tunnel** | Cloudflare Tunnel | Expose local backend to Vercel |
| **Monorepo** | pnpm workspaces | Multi-package project management |
| **Package Manager** | pnpm | Fast, disk-efficient installs |

---

## Features

### Search (Document RAG)
- Upload any document (PDF, DOCX, PPTX, XLSX, HTML, TXT, CSV, JSON, images)
- Automatic Vision OCR fallback for scanned/image-only PDFs
- Semantic chunking with sentence-boundary awareness
- Chat interface with grounded answers and source citations
- Category-filtered search (general docs vs. resumes are isolated)
- Hard guardrails: hallucinated citations stripped server-side via instructor

### Resumes
- Upload base resume (PDF/DOCX) → auto-indexed into vector store
- Realtime status updates: `pending → processing → ready`
- View extracted Markdown + copy to clipboard
- Delete with storage cleanup
- Resume data strictly isolated from general document search

### Tracker (Job Application Pipeline)
- Full kanban-style job application tracker
- Upload JD → auto-triggers 3-stage tailoring pipeline
- Stage 1: analytical gap analysis (match score 0-100, missing keywords, highlights)
- Stage 2: AI-rewritten resume sections (bullets, summary, cover letter opener)
- Stage 3: DOCX + PDF generation (pure Python, no extra LLM call)
- CSV export of all applications
- Filter by status, search by company/role

### Convert (Markdown Generator)
- One-click document → Markdown conversion (no storage, ephemeral)
- Stats: character count, word count, estimated tokens
- Token budget color indicator (green/amber/red)
- Copy or download `.md` file
- Visual "Vision OCR" badge when scanned PDF fallback was triggered

---

## Known Limitations

| # | Limitation | Impact |
|---|---|---|
| L1 | Cloudflare Tunnel URL changes on every restart | `VITE_DOCMIND_API_URL` must be updated in Vercel env vars each session |
| L2 | No authentication on FastAPI backend | Anyone with the tunnel URL can call the API |
| L3 | Scanned PDF OCR blocks the main request thread | 50-page scanned PDFs can approach the 60s timeout |
| L4 | Context window capped at 8k tokens | Very long documents need LLMLingua (currently optional) |
| L5 | Single-user architecture | Supabase queries are not user-scoped in the Search page |
| L6 | Worker is a blocking polling loop | No task queue — only one document processes at a time |

---

## Scope for Improvement

### High Priority
| # | Improvement | Effort | Impact |
|---|---|---|---|
| I1 | **Persistent tunnel** — use a named Cloudflare tunnel (free) so the URL never changes | Low | 🔥 High |
| I2 | **Async OCR** — process scanned PDFs as background tasks with a progress webhook | Medium | 🔥 High |
| I3 | **Auth** — add Supabase Auth to scope all data per user (resumes, search docs) | Medium | 🔥 High |
| I4 | **Task queue** — replace polling loop with Supabase Edge Functions or a proper queue | High | 🔥 High |

### Medium Priority
| # | Improvement | Effort | Impact |
|---|---|---|---|
| I5 | **Streaming responses** — stream RAG answers token-by-token via SSE for instant UX | Medium | 🟡 Medium |
| I6 | **Re-ranking** — add a cross-encoder re-ranker after vector search to improve citation quality | Medium | 🟡 Medium |
| I7 | **Multi-document comparison** — ask questions across multiple specific documents | Medium | 🟡 Medium |
| I8 | **Hybrid search** — combine pgvector cosine similarity with BM25 keyword search | High | 🟡 Medium |
| I9 | **LLMLingua always-on** — enable token compression for all large documents | Low | 🟡 Medium |
| I10 | **Model switching UI** — let user select chat/embed model from the sidebar | Low | 🟡 Medium |

### Low Priority
| # | Improvement | Effort | Impact |
|---|---|---|---|
| I11 | **Conversation history** — persist chat sessions across page refreshes | Low | 🟢 Low |
| I12 | **Chunk visualizer** — show what text was chunked from each document | Low | 🟢 Low |
| I13 | **Dark mode** — toggle between light and dark theme | Low | 🟢 Low |
| I14 | **PDF preview** — show inline PDF viewer next to the Markdown output | Medium | 🟢 Low |
| I15 | **Ollama model management** — pull/delete models from the UI | Low | 🟢 Low |

---

## File Structure

```
docmind-hybrid/
├── artifacts/
│   ├── docmind/                  # Main React app (Vercel)
│   │   └── src/pages/
│   │       ├── home.tsx          # Document Search (RAG chat)
│   │       ├── resumes.tsx       # Resume manager
│   │       ├── tracker.tsx       # Job application tracker
│   │       └── convert.tsx       # Markdown generator
│   └── mockup-sandbox/           # Prototype / sandbox app
├── backend/
│   └── app/
│       ├── api.py                # FastAPI routes
│       ├── config.py             # Settings (env vars)
│       ├── cleaner.py            # PDF text artifact fixes
│       ├── context_manager.py    # Token budget allocator
│       ├── document_processing.py# MarkItDown + OCR pipeline
│       ├── docx_renderer.py      # Stage 3 DOCX generator
│       ├── main.py               # FastAPI app factory + CORS
│       ├── models.py             # Pydantic API models
│       ├── ollama.py             # Ollama HTTP client
│       ├── prompts.py            # LLM prompt templates
│       ├── rag.py                # RAG answer generation
│       ├── schemas.py            # instructor output schemas
│       ├── supabase_store.py     # Vector store operations
│       └── worker.py             # Background polling worker
└── supabase/
    ├── schema.sql                # Full DB schema + RPC functions
    └── run_this_in_supabase.sql  # Quick-start migration

---

## Setup: Persistent Tunnel

By default, Cloudflare Tunnel assigns a random URL every time it starts. To avoid updating `VITE_DOCMIND_API_URL` constantly, set up a persistent tunnel:

### Option A: ngrok (Free Static Domain)
1. Sign up at [ngrok.com](https://ngrok.com) and get your authtoken.
2. Claim your free static domain (e.g., `your-name.ngrok-free.app`).
3. Authenticate locally: `ngrok config add-authtoken <your-token>`
4. Run: `ngrok http --domain=your-name.ngrok-free.app 8000`

### Option B: Cloudflare Tunnel (Requires your own domain)
1. Install: `brew install cloudflare/cloudflare/cloudflared`
2. Login: `cloudflared tunnel login`
3. Create: `cloudflared tunnel create docmind-local`
4. Route: `cloudflared tunnel route dns docmind-local docmind-api.yourdomain.com`
5. Run: `cloudflared tunnel run docmind-local`

Alternatively, use the convenience script `scripts/start-local.sh`.
