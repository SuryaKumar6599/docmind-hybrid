# Deployment

## Supabase

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Copy your project URL and service role key.

Use the service role key only in the local backend `.env`. Do not put it in the browser or Vercel public environment variables.

## Local Backend

```bash
cd docmind-hybrid/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

If you are in the project root instead of `backend/`, the same command works:

```bash
cd docmind-hybrid
uvicorn app.main:app --reload --port 8000
```

## Cloudflare Tunnel

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```

Copy the generated `https://...trycloudflare.com` URL.

## Vercel

```bash
cd docmind-hybrid/web
npm install
npm run build
```

Deploy `docmind-hybrid/web` to Vercel.

Set this Vercel environment variable:

```bash
NEXT_PUBLIC_DOCMIND_API_URL=https://your-cloudflare-url.trycloudflare.com
```

Redeploy after changing environment variables.

## Production Notes

- Temporary Cloudflare tunnel URLs change when restarted. For a stable URL, create a named Cloudflare Tunnel.
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on your Mac.
- Add your final Vercel URL to `DOCMIND_CORS_ORIGINS`.
- For large files, increase FastAPI/server timeout and chunk in batches before inserting into Supabase.
