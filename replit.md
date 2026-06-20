# DocMind

Private enterprise document search + Resume Tailoring & Job Application Tracker.

Upload files to a local Ollama/FastAPI backend, ask questions across indexed documents, upload your resume, paste a JD, and get a tailored DOCX/PDF output with match analysis.

## Run & Operate

- `pnpm --filter @workspace/docmind run dev` — frontend (Vite, port assigned by workflow)
- `pnpm --filter @workspace/api-server run dev` — API server scaffold (port 5000, not used by DocMind directly)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: Vite + React, Tailwind CSS v4, wouter routing
- API: Express 5 (scaffold), FastAPI (local worker)
- DB: PostgreSQL + Drizzle ORM (scaffold) + Supabase (pgvector + Storage + Realtime)
- Validation: Zod (`zod/v4`), Pydantic v2 + `instructor`
- LLMs: Ollama `qwen2.5:7b` (chat/extraction), `qwen2.5vl:7b` (vision OCR), `nomic-embed-text` (embeddings)

## Where things live

- `artifacts/docmind/src/App.tsx` — routing: / (Search), /resumes, /tracker
- `artifacts/docmind/src/lib/supabase.ts` — Supabase browser client + types
- `artifacts/docmind/src/pages/home.tsx` — RAG chat interface
- `artifacts/docmind/src/pages/resumes.tsx` — resume upload + realtime status
- `artifacts/docmind/src/pages/tracker.tsx` — application tracker (Bonsai Memory pattern)
- `artifacts/docmind/src/components/nav.tsx` — top nav bar
- `artifacts/docmind/src/index.css` — Tailwind v4 theme
- `backend/app/worker.py` — async polling loop (resume ingestion + 3-stage tailoring pipeline)
- `backend/app/schemas.py` — Pydantic models (JobMatchAnalysis, TailoredContent)
- `backend/app/prompts.py` — Stage 1 & 2 prompt templates (Lost-in-the-Middle layout)
- `backend/app/context_manager.py` — 8k token budget allocator + LLMLingua wrapper
- `backend/app/docx_renderer.py` — Stage 3 pure-Python DOCX/PDF generation (no LLM)
- `supabase/schema.sql` — full DB schema + RPCs + triggers + Realtime
- `supabase/SETUP.md` — step-by-step Supabase setup guide
- `claude.md` — AI agent context guide (architecture rules, token stack, directory map)

## Architecture — 3-Stage Pipeline

```
Upload JD (browser) → Supabase Storage (job-descriptions bucket)
                    → job_applications row (status=pending_processing)
                              ↓  (worker polls every 10s)
Stage 1 [Analytical]: MarkItDown converts JD+Resume → Markdown
                       Qwen2.5:7b via instructor → JobMatchAnalysis JSON
                       (missing_keywords, matched_skills, match_score, core_highlights)
                              ↓
Stage 2 [Creative]:   Qwen2.5:7b rewrites summary + bullets → TailoredContent JSON
                       "Lost in the Middle": missing_keywords TOP, highlights BOTTOM
                              ↓
Stage 3 [Structural]: python-docx injects text → .docx + pandoc PDF (NO LLM)
                       Upload to tailored-resumes bucket
                              ↓
Supabase Realtime → browser shows download links instantly
```

## Environment Variables

### Frontend (set in Replit Secrets / `.env.local`)
- `VITE_SUPABASE_URL` — your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key (safe for browser, RLS enforces access)
- `VITE_DOCMIND_API_URL` — Cloudflare/ngrok tunnel URL to local FastAPI

### Backend (`backend/.env` — never commit this)
- `SUPABASE_URL` — same as above
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (never expose to browser)
- `OLLAMA_BASE_URL` — default `http://localhost:11434`
- `OLLAMA_CHAT_MODEL` — default `qwen2.5:7b`
- `OLLAMA_VISION_MODEL` — default `qwen2.5vl:7b`
- `OLLAMA_EMBED_MODEL` — default `nomic-embed-text`

## First-time Supabase Setup

See `supabase/SETUP.md` for the full step-by-step guide.

**Quick version:**
1. Run `supabase/schema.sql` in Supabase SQL Editor
2. Create 3 Storage buckets via dashboard: `resumes`, `job-descriptions`, `tailored-resumes` (all private)
3. Run open RLS policies from `supabase/SETUP.md` Step 3
4. Start local worker: `cd backend && python -m app.worker`

## Gotchas

- `VITE_DOCMIND_API_URL` must be set to your Cloudflare Tunnel URL — the green dot on Search tab confirms it's connected.
- Storage buckets **must be created via the Supabase dashboard** (Storage → New bucket), not just SQL, because the `storage.buckets` INSERT requires superuser access on some plans.
- The amber dot on "Local backend" turns green when `VITE_DOCMIND_API_URL` is set.
- Git push requires GitHub connected in Replit Account → Connected services.
- Worker must be running locally (on your Mac) for the tailoring pipeline to execute — the frontend only queues jobs.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
