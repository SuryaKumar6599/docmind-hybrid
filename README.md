# DocMind Hybrid

> Private, local-first AI document search + Markdown Generator + Resume Tailoring + Job Application Tracker.  
> **Zero cloud LLM costs.** All inference runs on your own machine via Ollama.

---

## What it does

| Feature | Description |
|---------|-------------|
| **Document Search** | Upload PDFs/DOCX → ask questions → get cited answers |
| **Markdown Generator** | Convert any document (PDF/DOCX/PPTX/images…) to clean Markdown via Microsoft MarkItDown — for LLM input prep |
| **Resume Tailoring** | Upload resume + Job Description → tailored DOCX/PDF with missing keywords injected |
| **Application Tracker** | Track applications, see AI gap analysis, rewritten bullets, cover letter, match score |

---

## Architecture

```
Browser (Vite + React on Replit)
    │
    ├── Supabase (Storage + PostgreSQL + Realtime)
    │       ↕ (file uploads, DB reads, live updates)
    │
    └── Cloudflare Tunnel → Local FastAPI Worker (your Mac/PC)
                                    │
                                    ├── MarkItDown  (PDF/DOCX/PPTX/images → Markdown)
                                    ├── LLMLingua   (token compression, optional)
                                    ├── Ollama qwen2.5:7b  (chat + skill extraction)
                                    ├── Ollama qwen2.5vl:7b (vision OCR for images)
                                    └── nomic-embed-text   (vector embeddings)
```

### 3-Stage Resume Tailoring Pipeline

```
Upload JD → Supabase Storage → DB row (pending_processing)
                                    ↓ worker polls every 10 s
Stage 1 [Analytical]   MarkItDown converts JD + Resume → Markdown
                        Qwen2.5:7b → JobMatchAnalysis JSON
                        (missing_keywords, matched_skills, match_score, one_line_pitch)
                                    ↓
Stage 2 [Creative]     Qwen2.5:7b rewrites summary + bullets → TailoredContent JSON
                        "Lost in the Middle": keywords at TOP, highlights at BOTTOM
                        (tailored_summary, rewritten_bullets, skills_to_add, cover_letter_opening)
                                    ↓
Stage 3 [Structural]   python-docx → .docx + pandoc → .pdf  (NO LLM)
                        Upload to Supabase tailored-resumes bucket
                                    ↓
Supabase Realtime → Browser shows download links instantly
```

---

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| Node.js 20+ | Frontend | [nodejs.org](https://nodejs.org) |
| pnpm | Package manager | `npm i -g pnpm` |
| Python 3.11+ | Local backend | [python.org](https://python.org) |
| Ollama | Local LLM runtime | [ollama.com](https://ollama.com) |
| pandoc *(optional)* | PDF export | `brew install pandoc` |
| cloudflared | Expose local backend | [cloudflare.com](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/SuryaKumar6599/docmind-hybrid.git
cd docmind-hybrid
```

### 2. Pull Ollama models

```bash
ollama pull qwen2.5:7b
ollama pull qwen2.5vl:7b
ollama pull nomic-embed-text
```

### 3. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. **SQL Editor → New query** — paste `supabase/run_this_in_supabase.sql` and click **Run**
3. **Storage → New bucket** — create three **private** buckets:
   - `resumes`
   - `job-descriptions`
   - `tailored-resumes`
4. In SQL Editor, run the storage policies from `supabase/SETUP.md`

### 4. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # Settings → API → service_role
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
OLLAMA_VISION_MODEL=qwen2.5vl:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
DOCMIND_CORS_ORIGINS=http://localhost:3000,https://*.replit.dev,https://your-app.replit.app
```

### 5. Start the backend (your Mac — 3 terminals)

```bash
# Terminal 1 — FastAPI server
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Polling worker (processes resume tailoring jobs)
cd backend
python -m app.worker

# Terminal 3 — Cloudflare Tunnel
cloudflared tunnel --url http://localhost:8000
# Copy the https://xxxx.trycloudflare.com URL — you'll need it in step 7
```

### 6. Configure the frontend (Replit Secrets)

In Replit, go to **Secrets** and add:

| Secret | Value |
|--------|-------|
| `VITE_SUPABASE_URL` | `https://your-project.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (Settings → API → anon public) |
| `VITE_DOCMIND_API_URL` | `https://xxxx.trycloudflare.com` |

> For local development, create `artifacts/docmind/.env.local` with the same three keys instead.

### 7. Start the frontend

Replit starts this automatically. To run locally:

```bash
pnpm install
pnpm --filter @workspace/docmind run dev
```

Open the preview pane in Replit, or [http://localhost:5173](http://localhost:5173) locally.

---

## Deploying to production

### Frontend: Vercel (recommended)

The Vite React frontend is a fully static SPA — deploy it once and forget it.

```bash
cd artifacts/docmind
npx vercel deploy --prod
```

In the Vercel dashboard → **Settings → Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://your-project.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_DOCMIND_API_URL` | Your permanent tunnel URL (see backend setup below) |

---

### Backend: Auto-start on Mac Boot (Recommended — Zero Manual Effort)

The backend runs Ollama locally for free, open-source inference. A one-time setup script creates a **permanent Cloudflare Tunnel** (stable URL that never changes) and installs a **macOS LaunchAgent** so everything auto-starts on boot.

**Run once:**

```bash
chmod +x scripts/setup-tunnel.sh
./scripts/setup-tunnel.sh
```

This script will:
1. Open a browser to log you into Cloudflare (free account)
2. Create a named tunnel `docmind-api` with a **permanent stable URL** like `https://<uuid>.cfargotunnel.com`
3. Install a macOS LaunchAgent that starts FastAPI + worker + tunnel automatically on every boot
4. Print the exact `VITE_DOCMIND_API_URL` value to paste into Vercel

**After setup:**
- Copy the printed URL → paste into Vercel as `VITE_DOCMIND_API_URL`
- Redeploy Vercel (`npx vercel deploy --prod`)
- The "Local backend unreachable" banner will be gone permanently

**Logs** (for debugging):
```bash
tail -f logs/backend.log    # FastAPI uvicorn
tail -f logs/worker.log     # background Supabase worker
tail -f logs/tunnel.log     # cloudflared tunnel
```

**LaunchAgent management:**
```bash
# Stop everything
launchctl unload ~/Library/LaunchAgents/com.docmind.backend.plist

# Start everything (or just reboot)
launchctl load -w ~/Library/LaunchAgents/com.docmind.backend.plist
```

---

### Backend: Other Options

| Option | Setup | Notes |
|--------|-------|-------|
| **Auto Mac + Named Tunnel** *(above)* | `./scripts/setup-tunnel.sh` | ✅ Recommended — zero manual effort |
| **Render** | Push to GitHub → Render web service, set `PORT=8000` | No GPU on free tier — Ollama slow |
| **Railway** | Deploy from GitHub, GPU plans available | ~$5/month for GPU |
| **Self-hosted VPS** | `uvicorn app.main:app --host 0.0.0.0 --port 8000` | Full control, best for production |

For any hosted backend, set:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
OLLAMA_VISION_MODEL=qwen2.5vl:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
DOCMIND_CORS_ORIGINS=https://your-app.vercel.app
```

---

## Git workflow

### First-time setup

```bash
# Connect to GitHub from Replit: Account → Connected services → GitHub
git remote set-url origin https://github.com/SuryaKumar6599/docmind-hybrid.git
```

### Commit and push changes

```bash
# Stage all changes
git add -A

# Commit with a descriptive message
git commit -m "feat: add Markdown Generator + enhanced tracker + resumes drag-drop"

# Push to main
git push origin main
```

### Common git commands

```bash
git --no-optional-locks status        # see what changed
git log --oneline -10                 # recent commits
git diff HEAD~1 HEAD --stat           # what changed in last commit
git stash                             # temporarily hide uncommitted changes
git stash pop                         # restore stashed changes
```

> **Note:** Destructive git operations (reset, rebase, force-push) must be run from the Replit **Shell** tab — the agent sandbox blocks them for safety.

---

## Usage guide

### Search tab (`/`)
1. Drag & drop or click to upload any PDF, DOCX, PPTX, HTML, or image
2. Click **Index Document** — backend converts it with MarkItDown and stores embeddings
3. Ask any question in the chat → get cited answers
4. Use quick-question chips for common queries
5. **Clear chat** button resets the conversation

### Markdown Generator tab (`/convert`)
1. Drag & drop or click to upload any supported file
2. Click **Convert to Markdown**
3. See the clean Markdown output with stats:
   - Character count, word count, **estimated token count** (colour-coded vs 8k budget)
4. **Copy** to clipboard or **Download as .md** file
5. Paste into any LLM prompt — clean, structured, no garbage characters

**Supported formats:** PDF · DOCX · PPTX · XLSX · HTML · TXT · CSV · JSON · XML · PNG/JPG/GIF/BMP (vision OCR)

### Resumes tab (`/resumes`)
1. Drag & drop or click to upload a PDF or DOCX resume
2. Wait for status: Queued → Processing → **Ready**
3. Expand a ready resume to **preview the extracted Markdown** and copy it
4. Delete resumes you no longer need with the trash icon

### Tracker tab (`/tracker`)
1. **Quick Skills Check** — paste resume text + JD text → instant gap analysis (no file upload needed)
   - Missing keywords (copy all at once)
   - Matched skills
   - AI match score (0–100)
   - One-line pitch
   - Skills you can honestly claim
   - **Track this application** — saves analysis to tracker with match score pre-filled
2. **Add Application** — select resume, enter company + role, optionally upload JD file
   - Triggers full 3-stage pipeline automatically
   - Duplicate detection warns you before saving
   - Keyboard: `Esc` to cancel, `⌘↵` / `Ctrl+Enter` to save
3. **Expand any row** to see:
   - **AI Analysis tab** — match score, missing keywords, strengths
   - **Tailored Content tab** — cover letter opening, tailored summary, rewritten bullets diff (original vs rewritten side-by-side), skills to add
   - **Notes tab** — inline editable notes, saved to Supabase
4. **Filter / search** by company, role, or status
5. **Export CSV** — downloads all applications as a spreadsheet
6. Status cards (To Apply / Applied / Interview / Offer) are clickable filters

---

## Token optimisation stack

| Tool | Role |
|------|------|
| **MarkItDown** | Converts PDF/DOCX/PPTX → clean Markdown before LLM input |
| **LLMLingua** | Strips low-entropy boilerplate from long resumes/JDs (optional, auto-detected) |
| **tiktoken** | Counts tokens to enforce the 8k context budget |
| **instructor + Pydantic** | Forces Qwen to output valid structured JSON (no regex parsing) |

**Token budget (8k window):**
```
System prompt  800 tokens  (fixed)
JSON schema   1200 tokens  (fixed)
JD text       3000 tokens  (hard cap — LLMLingua compresses if over)
Resume text   3000 tokens  (remainder — LLMLingua compresses if over)
```

---

## Project structure

```
.
├── artifacts/docmind/          # Vite + React frontend
│   └── src/
│       ├── App.tsx             # Routing (/, /resumes, /tracker, /convert)
│       ├── lib/supabase.ts     # Typed Supabase client + all TS interfaces
│       ├── pages/
│       │   ├── home.tsx        # RAG chat — doc upload, indexed-doc history
│       │   ├── resumes.tsx     # Resume upload, drag-drop, markdown preview, delete
│       │   ├── tracker.tsx     # Full tracker: Quick Skills Check, app rows, CSV export
│       │   └── convert.tsx     # Markdown Generator (MarkItDown standalone)
│       └── components/nav.tsx  # Navigation bar (Search / Resumes / Tracker / Convert)
├── backend/                    # Local FastAPI worker (runs on your Mac)
│   └── app/
│       ├── api.py              # Routes: /health /index /ask /extract-skills /convert
│       ├── worker.py           # Polling loop — resume ingestion + 3-stage pipeline
│       ├── document_processing.py  # MarkItDown wrapper + chunker
│       ├── schemas.py          # Pydantic models (instructor-enforced)
│       ├── prompts.py          # Stage 1 & 2 prompt templates
│       ├── context_manager.py  # Token budget allocator + LLMLingua
│       ├── docx_renderer.py    # Stage 3 DOCX/PDF generation (no LLM)
│       ├── rag.py              # RAG answer with instructor
│       ├── cleaner.py          # PDF text artifact fixer
│       └── ollama.py           # OllamaClient (chat + vision OCR)
├── supabase/
│   ├── run_this_in_supabase.sql  # Full DB schema (run once)
│   └── SETUP.md                  # Step-by-step Supabase setup guide
└── README.md                     # This file
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{status: "ok"}` |
| `POST` | `/index` | Upload + index a document (multipart `file`) |
| `POST` | `/ask` | RAG query — `{question, match_count}` → `{answer, citations}` |
| `POST` | `/extract-skills` | Skills gap analysis — `{resume_text, jd_text}` → `JobMatchAnalysis` |
| `POST` | `/convert` | MarkItDown conversion — multipart `file` → `{markdown, char_count, word_count, estimated_tokens}` |

---

## Environment variables reference

### Frontend (`artifacts/docmind/.env.local` or Replit Secrets)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (safe for browser, RLS enforces access) |
| `VITE_DOCMIND_API_URL` | Cloudflare tunnel URL to local FastAPI |

### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role key (keep secret — never expose to browser) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_CHAT_MODEL` | `qwen2.5:7b` | Chat + extraction model |
| `OLLAMA_VISION_MODEL` | `qwen2.5vl:7b` | Vision OCR model |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `DOCMIND_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `TOKEN_BUDGET_TOTAL` | `8000` | Total token budget |
| `WORKER_POLL_INTERVAL` | `10` | Seconds between Supabase polls |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Amber dot on Search / Convert / Tracker | Set `VITE_DOCMIND_API_URL` in Replit Secrets |
| "Local backend unreachable" banner | Start FastAPI (`uvicorn app.main:app`) + Cloudflare Tunnel on your Mac |
| Resume stuck at "Queued" | Start the worker: `cd backend && python -m app.worker` |
| PDF conversion garbled | MarkItDown uses vision OCR for scanned PDFs — ensure `qwen2.5vl:7b` is pulled |
| Token count > 8k in Markdown Generator | LLMLingua will compress it automatically in the pipeline; for manual use, chunk the output |
| Git push blocked in agent | Run git commands from the Replit **Shell** tab |

---

## License

MIT — see [LICENSE](LICENSE)
