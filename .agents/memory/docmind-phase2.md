---
name: DocMind Phase 2 Architecture
description: Key constraints for the Resume Tailoring & Application Tracker feature.
---

## Critical Rules (never violate)
1. **Never call Ollama from Next.js/Vite route handlers** — all LLM work runs in `backend/app/worker.py` polling loop.
2. **Always use `instructor`** for structured LLM output — never `json.loads(raw)` or regex.
3. **Always call `allocate_budget()`** from `context_manager.py` before building prompts (8k budget: 800 system / 1200 schema / 3000 JD / 3000 resume).
4. **Stage 3 (DOCX/PDF) is pure Python** — no LLM calls in `docx_renderer.py`.
5. **Lost in the Middle**: missing_keywords at TOP, core_highlights at BOTTOM of user messages.

**Why:** Vercel's 10s timeout + privacy (no PII to cloud LLMs) + structured output reliability.

## Supabase tables
- `resumes` — base resume storage, status lifecycle, markdown_content set by worker
- `job_applications` — tracker + stage1_analysis (JSONB) + stage2_content (JSONB) + docx_url/pdf_url
- Both tables have Realtime enabled for live UI updates

## Frontend env vars needed
- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key safe for browser, RLS enforces access)
- `VITE_DOCMIND_API_URL` (Cloudflare tunnel to local FastAPI)

## wouter Nav gotcha
- `<Link>` from wouter renders as `<a>` — never nest an `<a>` inside it (causes hydration error).
- Use `<Link href={to} className="...">` directly, not `<Link><a className="...">`.
