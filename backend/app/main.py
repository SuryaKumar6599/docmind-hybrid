from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="DocMind Local AI Service", version="2.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        # Vercel preview deployments get a random hash/branch suffix on every
        # PR, so a static origin list can't keep up — match the prod project
        # by regex instead. Update the slug here if the Vercel project moves.
        allow_origin_regex=r"https://docmind-hybrid-api-server-wa3m(-[a-z0-9]+)?\.vercel\.app",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app


app = create_app()

