# `docmind-hybrid` — AI Agent Context Guide

This file is the **single source of truth** for AI agents (Claude, GPT, Gemini, etc.) working on this repository. Read it entirely before touching any code.

---

## 1. What This Project Is

DocMind Hybrid is a privacy-first, AI-powered Resume Tailoring & Job Application Tracker:

- **Frontend**: Vite + React (on Replit) / Next.js (on Vercel)
- **Database**: Supabase (PostgreSQL + pgvector + Storage + Realtime)
- **AI Engine**: Local FastAPI worker on Apple Silicon M4, using Ollama
- **LLMs**: `qwen2.5:7b` (text/chat), `qwen2.5vl:7b` (vision/OCR), `nomic-embed-text` (embeddings)

---

## 2. Critical Architecture Rules — DO NOT VIOLATE

### Rule 1: Async Worker Pattern (Vercel 10s timeout)
```
Next.js → Supabase Storage (file) + DB row (status=pending_processing)
       ↓
FastAPI Worker polls Supabase every 10s → processes → updates row (status=ready)
       ↓
Next.js Supabase Realtime → updates UI
```
**NEVER call Ollama, MarkItDown, or LLMLingua from a Next.js Route Handler.**  
All heavy processing runs in `backend/app/worker.py` on the local machine.

### Rule 2: instructor + Pydantic = No Raw JSON Parsing
All LLM calls that need structured output **must** use `instructor`:
```python
client = instructor.from_openai(raw_openai_client, mode=instructor.Mode.JSON)
result: MySchema = client.chat.completions.create(response_model=MySchema, max_retries=3, ...)
```
**NEVER use regex or `json.loads(raw_llm_output)`** — instructor retries automatically on validation failure.  
Relevant schemas: `backend/app/schemas.py` (`JobMatchAnalysis`, `TailoredContent`).

### Rule 3: Token Budget (8k context window)
```
Total: 8000 tokens
├── System prompt:  800  (fixed — never exceed)
├── JSON schema:   1200  (fixed)
├── JD text:       3000  (hard cap — truncate beyond)
└── Resume text:   3000  (remainder — compress with LLMLingua if over budget)
```
Always call `allocate_budget(jd_text, resume_text)` from `backend/app/context_manager.py` before building prompts.

### Rule 4: Lost-in-the-Middle Mitigation (Shi et al., 2023)
```
[TOP]    — Highest-priority content (missing keywords, JD requirements)
[MIDDLE] — Bulk resume content
[BOTTOM] — Second-highest priority (candidate highlights, core strengths)
```
See `backend/app/prompts.py` for the canonical implementations of `build_stage1_user_message` and `build_stage2_user_message`.

### Rule 5: Stage 3 is Pure Python — No LLM
`backend/app/docx_renderer.py` injects text into DOCX via `python-docx`. The LLM's job is done after Stage 2. **Never ask the LLM to generate XML, HTML, or document markup.**

---

## 3. Token Optimization Stack

| Tool | Where Used | What It Does |
|------|-----------|--------------|
| **microsoft/LLMLingua** | `backend/app/context_manager.py` | Strips low-entropy boilerplate from resume/JD text using perplexity. Only invoked when text exceeds token budget. |
| **yamadashy/repomix** | Developer tooling | Packs the full repo into a single clean text file for AI-assisted refactors. Run: `repomix . -o repomix-output.txt` |
| **open-compress/claw-compactor** | Conceptual (JSONB in Supabase) | AST-aware compression for dense JSON payloads (Stage 1/2 outputs stored in `stage1_analysis`, `stage2_content` JSONB columns). |
| **felixsim/bonsai-memory** | Application Tracker UI | Progressive disclosure pattern: show high-level status first, expand to details on demand. Cuts active UI context 70-95%. |

---

## 4. Directory Map

```
.
├── artifacts/docmind/          # Vite+React frontend (Replit)
│   └── src/
│       ├── App.tsx             # Routing: / (RAG), /resumes, /tracker
│       ├── lib/supabase.ts     # Supabase browser client
│       ├── pages/
│       │   ├── home.tsx        # RAG chat interface
│       │   ├── resumes.tsx     # Resume upload + management
│       │   └── tracker.tsx     # Application tracker (Realtime)
│       └── components/nav.tsx  # Navigation bar
├── backend/                    # Local FastAPI worker (runs on dev machine)
│   └── app/
│       ├── config.py           # Settings (env vars, token budgets)
│       ├── cleaner.py          # Robust PDF artifact fixer
│       ├── schemas.py          # Pydantic schemas (JobMatchAnalysis, TailoredContent)
│       ├── prompts.py          # Stage 1 & 2 prompt templates
│       ├── context_manager.py  # Token budget allocator + LLMLingua wrapper
│       ├── docx_renderer.py    # Stage 3: DOCX/PDF generation (NO LLM)
│       ├── worker.py           # Main polling loop
│       ├── rag.py              # RAG answer with instructor (no regex parsing)
│       └── ollama.py           # OllamaClient (text + vision OCR)
│   └── scripts/
│       └── evaluate_rag.py     # Task D: local LLM-as-Judge evaluation
├── supabase/schema.sql         # Full DB schema + RLS + RPCs
└── claude.md                   # This file
```

---

## 5. Multi-Stage Pipeline Reference

```
File upload (Next.js) → Supabase Storage
       ↓
DB row: job_applications.status = 'pending_processing'
       ↓ (worker polls)
Stage 1 [Analytical]: compressed_resume + compressed_jd → JobMatchAnalysis
       ↓  (instructor-enforced JSON, max_retries=3)
DB update: match_score, stage1_analysis, status='stage1_complete'
       ↓
Stage 2 [Creative]:   original_summary + bullets + analysis → TailoredContent
       ↓  (instructor-enforced JSON, max_retries=3)
Stage 3 [Structural]: TailoredContent → python-docx → .docx + .pdf (NO LLM)
       ↓
Upload artifacts to Supabase Storage (tailored-resumes bucket)
       ↓
DB update: docx_url, pdf_url, status='ready'
       ↓
Next.js Realtime → UI shows download links
```

---

## 6. Environment Variables

```bash
# backend/.env (local FastAPI worker)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...        # Service role — never expose to browser
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
OLLAMA_VISION_MODEL=qwen2.5vl:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
TOKEN_BUDGET_TOTAL=8000
WORKER_POLL_INTERVAL=10

# artifacts/docmind/.env.local (Vite frontend)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...           # Anon key — safe for browser (RLS enforces access)
VITE_DOCMIND_API_URL=https://your-tunnel.trycloudflare.com
```

---

## 7. Running Locally

```bash
# 1. Start Ollama models
ollama run qwen2.5:7b
ollama pull nomic-embed-text

# 2. Start the FastAPI worker (separate terminal)
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. Start the polling worker (separate terminal)
cd backend && python -m app.worker

# 4. Expose via Cloudflare Tunnel
cloudflared tunnel --url http://localhost:8000

# 5. Start the frontend (Replit workflow handles this automatically)
pnpm --filter @workspace/docmind run dev

# 6. Run RAG evaluation
python -m backend.scripts.evaluate_rag \
  --test-set backend/scripts/test_set.jsonl \
  --output backend/scripts/eval_results.jsonl
```

---

## 8. What NOT to Do (Common Agent Mistakes)

- ❌ Call Ollama from a Next.js Route Handler
- ❌ Use `json.loads(llm_output)` — always use `instructor`
- ❌ Let the LLM write XML/HTML for DOCX (use `python-docx` directly)
- ❌ Skip `allocate_budget()` before building prompts
- ❌ Expose `SUPABASE_SERVICE_ROLE_KEY` to the browser — use the anon key + RLS
- ❌ Run `pnpm dev` at the workspace root on Replit (no root dev script; use workflows)
- ❌ Add new DB columns without updating `supabase/schema.sql`
