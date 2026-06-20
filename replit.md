# DocMind

Private enterprise document search — upload files to a local Ollama/FastAPI backend, then ask questions across indexed documents.

## Run & Operate

- `pnpm --filter @workspace/docmind run dev` — run the frontend (Vite, port assigned by workflow)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: Vite + React, Tailwind CSS v4, wouter routing
- API: Express 5 (scaffold, not used by DocMind directly — DocMind calls user's local backend)
- DB: PostgreSQL + Drizzle ORM (scaffold)
- Validation: Zod (`zod/v4`), `drizzle-zod`

## Where things live

- `artifacts/docmind/src/App.tsx` — main app UI (single-page, all logic here)
- `artifacts/docmind/src/index.css` — Tailwind v4 theme with DocMind colors (ink, moss, fern, paper, signal, amber)
- `artifacts/docmind/index.html` — HTML shell with Inter font

## Architecture decisions

- DocMind is a purely frontend app — it calls the user's self-hosted FastAPI backend directly from the browser via `VITE_DOCMIND_API_URL`.
- No Replit backend routes are needed; the api-server scaffold is present but unused.
- Converted from Next.js to Vite + React; `NEXT_PUBLIC_DOCMIND_API_URL` → `VITE_DOCMIND_API_URL`.
- Tailwind custom colors defined in CSS `@theme inline` block (Tailwind v4 pattern).

## Product

- Left sidebar: backend status indicator, document upload/index, status messages
- Right panel: chat-style Q&A interface — ask questions, see answers with citations from indexed documents

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Set `VITE_DOCMIND_API_URL` to your local backend tunnel URL (e.g. Cloudflare Tunnel) before using the app.
- The amber dot on "Local backend" turns green when `VITE_DOCMIND_API_URL` is set.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
