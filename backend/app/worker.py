"""Async polling worker — the core of the DocMind hybrid architecture.

Architecture (Async Worker Pattern):
  Next.js (Vercel) → Supabase Storage + DB row (status=pending_processing)
                               ↓  (this worker polls every N seconds)
  FastAPI Worker → downloads file → processes → updates row (status=ready/error)
                               ↓
  Next.js Realtime listener → updates UI
"""
from __future__ import annotations

import logging
import time
import traceback

from supabase import Client, create_client

from .config import Settings, get_settings
from .llm_gateway import get_chat_provider, get_embedding_provider
from .services.document_service import process_general_document, process_resume_ingestion
from .services.resume_service import process_tailoring

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("docmind.worker")


def run_polling_loop(settings: Settings) -> None:
    """Poll Supabase for pending_processing rows and process them.

    Runs indefinitely. Each error is caught per-row so one bad row
    cannot crash the entire worker process.
    """
    settings.require_supabase()
    supa: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    
    chat_provider = get_chat_provider(settings)
    embedding_provider = get_embedding_provider(settings)

    logger.info(
        "Worker started — polling every %ds (chat=%s, embedding=%s)", 
        settings.worker_poll_interval_seconds,
        settings.chat_provider,
        settings.embedding_provider
    )

    while True:
        try:
            # --- Poll resumes ---
            pending_resumes = (
                supa.table("resumes")
                .select("*")
                .eq("status", "pending_processing")
                .limit(5)
                .execute()
            )
            for row in pending_resumes.data:
                try:
                    process_resume_ingestion(supa, settings, chat_provider, embedding_provider, row)
                except Exception:
                    tb = traceback.format_exc()
                    logger.error("[RESUME %s] Failed:\n%s", row["id"], tb)
                    supa.table("resumes").update({
                        "status": "error",
                        "error_message": tb[-1000:],
                    }).eq("id", row["id"]).execute()

            # --- Poll search documents ---
            pending_docs = (
                supa.table("documents")
                .select("*")
                .eq("status", "pending_processing")
                .limit(5)
                .execute()
            )
            for row in pending_docs.data:
                try:
                    process_general_document(supa, settings, chat_provider, embedding_provider, row)
                except Exception:
                    tb = traceback.format_exc()
                    logger.error("[DOC %s] Failed:\n%s", row["id"], tb)
                    supa.table("documents").update({
                        "status": "error",
                        "error_message": tb[-1000:],
                    }).eq("id", row["id"]).execute()

            # --- Poll job applications ---
            pending_apps = (
                supa.table("job_applications")
                .select("*")
                .eq("status", "pending_processing")
                .limit(5)
                .execute()
            )
            for row in pending_apps.data:
                try:
                    process_tailoring(supa, settings, chat_provider, embedding_provider, row)
                except Exception:
                    tb = traceback.format_exc()
                    logger.error("[APP %s] Failed:\n%s", row["id"], tb)
                    supa.table("job_applications").update({
                        "status": "error",
                        "error_message": tb[-1000:],
                    }).eq("id", row["id"]).execute()

        except Exception:
            logger.error("Polling error (worker continues):\n%s", traceback.format_exc())

        time.sleep(settings.worker_poll_interval_seconds)


if __name__ == "__main__":
    run_polling_loop(get_settings())
