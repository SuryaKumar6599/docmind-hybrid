# DocMind Hybrid

Production-ready hybrid codebase for DocMind:

- Vercel hosts the Next.js UI in `web/`.
- Supabase stores documents and vectors with Postgres + `pgvector`.
- Your Mac runs the private FastAPI + Ollama backend in `backend/`.

Ollama never runs in Vercel or Supabase. Documents are sent to your local backend through a tunnel, converted locally, embedded locally, then stored in Supabase.

## Folder Structure

```text
docmind-hybrid/
  backend/
    app/                  # FastAPI app package
    tests/                # Unit tests
    .env                  # Local placeholder env
    .env.example
    requirements.txt
  docs/
    api.md
    architecture.md
    deployment.md
  scripts/
    apply_backend_to_docmind_local.sh
  supabase/
    schema.sql
  web/
    app/                  # Next.js app router UI
    .env.local
    .env.local.example
    package.json
```

## Quick Start

### 1. Supabase

Create a Supabase project, open SQL Editor, and run:

```bash
cd /Users/suryakumar/Documents/Projects/habit/docmind-hybrid
cat supabase/schema.sql
```

Paste the output into Supabase SQL Editor and run it.

### 2. Local Backend

```bash
cd /Users/suryakumar/Documents/Projects/habit/docmind-hybrid/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
DOCMIND_CORS_ORIGINS=http://localhost:3000,https://your-vercel-app.vercel.app
```

Pull local Ollama models:

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

Run backend:

```bash
uvicorn app.main:app --reload --port 8000
```

That command works from either:

- `/Users/suryakumar/Documents/Projects/habit/docmind-hybrid`
- `/Users/suryakumar/Documents/Projects/habit/docmind-hybrid/backend`

### 3. Next.js Web App

```bash
cd /Users/suryakumar/Documents/Projects/habit/docmind-hybrid/web
npm install
cp .env.local.example .env.local
```

For local development:

```bash
NEXT_PUBLIC_DOCMIND_API_URL=http://localhost:8000
npm run dev
```

Validate the web app:

```bash
npm run lint
npm run build
```

### 4. Expose Backend to Vercel

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```

Set the tunnel URL in Vercel:

```bash
NEXT_PUBLIC_DOCMIND_API_URL=https://your-random-url.trycloudflare.com
```

## Directly Update Existing DocMind-Local

If your existing backend is at `/Users/suryakumar/Documents/Projects/DocMind-Local`, run:

```bash
cd /Users/suryakumar/Documents/Projects/habit/docmind-hybrid
chmod +x scripts/apply_backend_to_docmind_local.sh
./scripts/apply_backend_to_docmind_local.sh /Users/suryakumar/Documents/Projects/DocMind-Local
```

Then:

```bash
cd /Users/suryakumar/Documents/Projects/DocMind-Local
cp .env.example .env
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000
```

## Tests

```bash
cd /Users/suryakumar/Documents/Projects/habit/docmind-hybrid/backend
source .venv/bin/activate
PYTHONPATH=. pytest
```

The tests use fakes for Ollama and Supabase where possible, so unit tests do not need cloud credentials.

## More Docs

- [Architecture](docs/architecture.md)
- [API](docs/api.md)
- [Deployment](docs/deployment.md)
