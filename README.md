# DocMind Hybrid

> Private, local-first AI document search + Resume Tailoring + Job Application Tracker.  
> **Zero cloud LLM costs.** All inference runs on your own machine via Ollama.

---

## What it does

| Feature | Description |
|---------|-------------|
| **Document Search** | Upload PDFs/DOCX → ask questions → get cited answers |
| **Resume Tailoring** | Upload your resume + a Job Description → get a tailored DOCX/PDF with missing keywords injected |
| **Application Tracker** | Track every application's status, match score, and tailored resume download |

---

## Architecture

```
Browser (Vite + React on Replit/Vercel)
    │
    ├── Supabase (Storage + PostgreSQL + Realtime)
    │       ↕ (file uploads, DB reads, live updates)
    │
    └── Cloudflare Tunnel → Local FastAPI Worker (your Mac/PC)
                                    │
                                    ├── MarkItDown  (PDF/DOCX → Markdown)
                                    ├── LLMLingua   (token compression, optional)
                                    ├── Ollama qwen2.5:7b  (chat + skill extraction)
                                    ├── Ollama qwen2.5vl:7b (vision OCR)
                                    └── nomic-embed-text   (vector embeddings)
```

### 3-Stage Resume Tailoring Pipeline

```
Upload JD → Supabase Storage → DB row (pending_processing)
                                    ↓ worker polls every 10s
Stage 1 [Analytical]   MarkItDown converts JD + Resume → Markdown
                        Qwen2.5:7b → JobMatchAnalysis JSON
                        (missing_keywords, matched_skills, match_score)
                                    ↓
Stage 2 [Creative]     Qwen2.5:7b rewrites summary + bullets
                        "Lost in the Middle": keywords at TOP, highlights at BOTTOM
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
| cloudflared | Tunnel to expose local backend | [cloudflare.com/products/tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/SuryaKumar6599/docmind-hybrid.git
cd docmind-hybrid
```

### 2. Pull Ollama models (required)

```bash
ollama pull qwen2.5:7b
ollama pull qwen2.5vl:7b
ollama pull nomic-embed-text
```

### 3. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor → New query**, paste the contents of [`supabase/run_this_in_supabase.sql`](supabase/run_this_in_supabase.sql) and click **Run**
3. Go to **Storage → New bucket**, create three **private** buckets:
   - `resumes`
   - `job-descriptions`
   - `tailored-resumes`
4. In SQL Editor run the storage policies from [`supabase/SETUP.md`](supabase/SETUP.md)

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
DOCMIND_CORS_ORIGINS=http://localhost:3000,https://*.replit.dev,https://your-app.vercel.app
```

### 5. Start the backend

```bash
# Terminal 1 — FastAPI server
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Polling worker (processes resume tailoring jobs)
cd backend
python -m app.worker
```

### 6. Expose via Cloudflare Tunnel

```bash
# Terminal 3
cloudflared tunnel --url http://localhost:8000
# Copy the https://xxxx.trycloudflare.com URL
```

### 7. Configure the frontend

```bash
cd artifacts/docmind
cp .env.example .env.local   # or create it manually
```

Edit `artifacts/docmind/.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key              # Settings → API → anon (public)
VITE_DOCMIND_API_URL=https://xxxx.trycloudflare.com
```

### 8. Start the frontend

```bash
pnpm install
pnpm --filter @workspace/docmind run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Deploying the frontend

### Option A — Replit (recommended)

The frontend is already configured as a Replit artifact. Set the three `VITE_*` env vars in **Replit Secrets** and deploy via **Replit Deployments**.

### Option B — Vercel

```bash
cd artifacts/docmind
vercel deploy
```

Set environment variables in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DOCMIND_API_URL`

> **Important:** The local FastAPI worker must always be running on your machine and exposed via Cloudflare Tunnel. The frontend is stateless — all AI processing happens locally.

---

## Usage

### Search tab
1. Click **Choose File** → pick any PDF, DOCX, PPTX, or image
2. Click **Index Document** — the backend converts it with MarkItDown and stores embeddings
3. Ask any question in the chat box → get cited answers from your documents

### Resumes tab
1. Upload your base resume (PDF or DOCX)
2. Wait for status to show **Ready** (the worker processed it with MarkItDown + nomic-embed-text)

### Tracker tab
1. Click **Add Application**
2. Select your resume, enter company + role
3. Upload the Job Description file (PDF/DOCX/TXT) — this triggers the AI pipeline
4. Watch the status update live: Queued → Processing → Analysed → Ready
5. Expand the row to see:
   - Match score (0–100)
   - Missing keywords to add to your resume
   - Your strongest matching skills
   - **Download tailored DOCX / PDF**

---

## Token Optimization Stack

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
JD text       3000 tokens  (hard cap — compressed if over)
Resume text   3000 tokens  (remainder — compressed if over)
```

---

## Project structure

```
.
├── artifacts/docmind/          # Vite + React frontend
│   └── src/
│       ├── App.tsx             # Routing (/, /resumes, /tracker)
│       ├── lib/supabase.ts     # Typed Supabase browser client
│       ├── pages/
│       │   ├── home.tsx        # RAG chat (Search tab)
│       │   ├── resumes.tsx     # Resume upload + Realtime status
│       │   └── tracker.tsx     # Application tracker dashboard
│       └── components/nav.tsx  # Navigation bar
├── backend/                    # Local FastAPI worker
│   └── app/
│       ├── worker.py           # Polling loop — resume ingestion + 3-stage pipeline
│       ├── schemas.py          # Pydantic models (instructor-enforced)
│       ├── prompts.py          # Stage 1 & 2 prompt templates
│       ├── context_manager.py  # Token budget allocator + LLMLingua
│       ├── docx_renderer.py    # Stage 3 DOCX/PDF generation (no LLM)
│       ├── rag.py              # RAG answer with instructor
│       ├── cleaner.py          # PDF text artifact fixer
│       └── ollama.py           # OllamaClient (chat + vision OCR)
│   └── scripts/
│       └── evaluate_rag.py     # Local LLM-as-Judge evaluation
├── supabase/
│   ├── run_this_in_supabase.sql  # Full DB schema (run once)
│   └── SETUP.md                  # Step-by-step setup guide
└── claude.md                   # AI agent context guide
```

---

## Environment variables reference

### Frontend (`artifacts/docmind/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (safe for browser) |
| `VITE_DOCMIND_API_URL` | Cloudflare tunnel URL to local FastAPI |

### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role key (keep secret) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_CHAT_MODEL` | `qwen2.5:7b` | Chat + extraction model |
| `OLLAMA_VISION_MODEL` | `qwen2.5vl:7b` | Vision OCR model |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `DOCMIND_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `TOKEN_BUDGET_TOTAL` | `8000` | Total token budget |
| `WORKER_POLL_INTERVAL` | `10` | Seconds between Supabase polls |

---

## License

MIT — see [LICENSE](LICENSE)
