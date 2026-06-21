"""Async polling worker — the core of the DocMind hybrid architecture.

Architecture (Async Worker Pattern):
  Next.js (Vercel) → Supabase Storage + DB row (status=pending_processing)
                               ↓  (this worker polls every N seconds)
  FastAPI Worker → downloads file → processes → updates row (status=ready/error)
                               ↓
  Next.js Realtime listener → updates UI

This worker handles two row types:
  - `resumes` table: ingests a base resume into Supabase vector store
  - `job_applications` table: runs the 3-stage tailoring pipeline
"""
from __future__ import annotations

import logging
import os
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

import instructor
import requests
from openai import OpenAI
from supabase import Client, create_client

from .cleaner import clean_pdf_text, clean_markdown
from .config import Settings, get_settings
from .context_manager import allocate_budget
from .docx_renderer import render_tailored_resume
from .document_processing import DocumentProcessor, chunk_text
from .prompts import (
    STAGE1_SYSTEM,
    STAGE2_SYSTEM,
    build_stage1_user_message,
    build_stage2_user_message,
)
from .schemas import JobMatchAnalysis, TailoredContent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("docmind.worker")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_instructor_client(settings: Settings) -> Any:
    raw = OpenAI(base_url=f"{settings.ollama_base_url}/v1", api_key="ollama")
    return instructor.from_openai(raw, mode=instructor.Mode.JSON)


def _download_from_supabase(
    supa: Client, bucket: str, storage_path: str, local_path: Path
) -> None:
    """Download a file from Supabase Storage to a local temp path."""
    response = supa.storage.from_(bucket).download(storage_path)
    local_path.write_bytes(response)
    logger.info("Downloaded %s/%s → %s", bucket, storage_path, local_path)


def _upload_to_supabase(
    supa: Client, bucket: str, storage_path: str, local_path: Path
) -> str:
    """Upload a local file to Supabase Storage and return the public URL."""
    with open(local_path, "rb") as f:
        data = f.read()
    supa.storage.from_(bucket).upload(
        storage_path, data, {"content-type": "application/octet-stream", "upsert": "true"}
    )
    url = supa.storage.from_(bucket).get_public_url(storage_path)
    logger.info("Uploaded → %s", url)
    return url


# ---------------------------------------------------------------------------
# Resume ingestion pipeline
# ---------------------------------------------------------------------------

def process_resume(
    supa: Client,
    settings: Settings,
    row: dict[str, Any],
) -> None:
    """Ingest a base resume into the Supabase vector store."""
    from .ollama import OllamaClient
    from .supabase_store import SupabaseVectorStore

    resume_id: str = row["id"]
    user_id: str = row["user_id"]
    storage_path: str = row["storage_path"]
    original_name: str = row.get("original_filename", "resume")

    logger.info("[RESUME %s] Starting ingestion", resume_id)
    supa.table("resumes").update({"status": "processing"}).eq("id", resume_id).execute()

    with tempfile.TemporaryDirectory() as tmpdir:
        local_file = Path(tmpdir) / Path(storage_path).name
        _download_from_supabase(supa, "resumes", storage_path, local_file)

        ollama = OllamaClient(settings)
        processor = DocumentProcessor(ollama_client=ollama)
        raw_markdown = processor.convert_to_markdown(local_file)
        cleaned = clean_markdown(raw_markdown)

        store = SupabaseVectorStore(settings)

        # Store in documents table with category='resume'
        doc_id = store.create_document(
            original_name,
            {"user_id": user_id, "category": "resume", "resume_id": resume_id},
            category="resume",
        )
        chunks = chunk_text(cleaned, chunk_size=600, overlap=80)
        embeddings = [ollama.embedding(chunk) for chunk in chunks]
        store.insert_chunks(doc_id, chunks, embeddings, {"category": "resume", "user_id": user_id})

        supa.table("resumes").update({
            "status": "ready",
            "document_id": doc_id,
            "markdown_content": cleaned,
            "chunk_count": len(chunks),
        }).eq("id", resume_id).execute()

    logger.info("[RESUME %s] Ingestion complete (%d chunks)", resume_id, len(chunks))


# ---------------------------------------------------------------------------
# General document ingestion pipeline
# ---------------------------------------------------------------------------

def process_document(
    supa: Client,
    settings: Settings,
    row: dict[str, Any],
) -> None:
    """Ingest a general document into the Supabase vector store async."""
    from .ollama import OllamaClient
    from .supabase_store import SupabaseVectorStore

    doc_id: str = row["id"]
    storage_path: str = row["storage_path"]
    original_name: str = row.get("name", "document")
    category: str = row.get("category", "general")

    logger.info("[DOC %s] Starting async ingestion", doc_id)
    supa.table("documents").update({"status": "processing"}).eq("id", doc_id).execute()

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            local_file = Path(tmpdir) / Path(storage_path).name
            _download_from_supabase(supa, "search-documents", storage_path, local_file)

            ollama = OllamaClient(settings)
            processor = DocumentProcessor(ollama_client=ollama)
            raw_markdown = processor.convert_to_markdown(local_file)
            
            if not raw_markdown.strip():
                raise ValueError(f"No text extracted from {original_name}")

            chunks = chunk_text(raw_markdown, chunk_size=800, overlap=100)
            embeddings = [ollama.embedding(chunk) for chunk in chunks]
            
            store = SupabaseVectorStore(settings)
            metadata = processor.metadata_for(local_file, original_name)
            store.insert_chunks(doc_id, chunks, embeddings, metadata)

            supa.table("documents").update({
                "status": "ready",
                "chunk_count": len(chunks),
            }).eq("id", doc_id).execute()

        logger.info("[DOC %s] Ingestion complete (%d chunks)", doc_id, len(chunks))
    except Exception as exc:
        logger.error("[DOC %s] Ingestion failed: %s", doc_id, exc)
        supa.table("documents").update({
            "status": "error",
            "error_message": str(exc),
        }).eq("id", doc_id).execute()
        raise


# ---------------------------------------------------------------------------
# Job application tailoring pipeline (3 stages)
# ---------------------------------------------------------------------------

def process_job_application(
    supa: Client,
    settings: Settings,
    row: dict[str, Any],
) -> None:
    """Run the full 3-stage tailoring pipeline for a job application."""
    app_id: str = row["id"]
    user_id: str = row["user_id"]
    jd_storage_path: str = row["jd_storage_path"]
    company: str = row.get("company_name", "Unknown Company")
    role: str = row.get("role", "Unknown Role")
    resume_id: str = row["resume_id"]

    logger.info("[APP %s] Starting tailoring pipeline for %s @ %s", app_id, role, company)
    supa.table("job_applications").update({"status": "processing"}).eq("id", app_id).execute()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)

        # --- Fetch base resume markdown ---
        resume_row = supa.table("resumes").select("markdown_content, original_filename").eq("id", resume_id).single().execute()
        resume_md: str = resume_row.data["markdown_content"]
        candidate_name: str = resume_row.data.get("original_filename", "Candidate").replace(".pdf", "").replace(".docx", "")

        # --- Download & convert JD ---
        jd_file = tmpdir_path / Path(jd_storage_path).name
        _download_from_supabase(supa, "job-descriptions", jd_storage_path, jd_file)
        ollama = OllamaClient(settings)
        processor = DocumentProcessor(ollama_client=ollama)
        raw_jd = processor.convert_to_markdown(jd_file)
        jd_md = clean_markdown(raw_jd)

        # --- Context Manager: fit within token budget ---
        budgeted = allocate_budget(
            jd_text=jd_md,
            resume_text=resume_md,
            budget_jd=settings.token_budget_jd,
            budget_resume=settings.token_budget_resume,
        )
        if budgeted.was_compressed:
            logger.info("[APP %s] Text was compressed (LLMLingua or truncation)", app_id)

        client = _make_instructor_client(settings)

        # --- Stage 1: Analytical gap analysis ---
        logger.info("[APP %s] Stage 1: Gap analysis", app_id)
        stage1_messages = [
            {"role": "system", "content": STAGE1_SYSTEM},
            {"role": "user", "content": build_stage1_user_message(
                budgeted.jd, budgeted.resume, company, role
            )},
        ]
        analysis: JobMatchAnalysis = client.chat.completions.create(
            model=settings.ollama_chat_model,
            messages=stage1_messages,
            response_model=JobMatchAnalysis,
            max_retries=3,
            temperature=0.0,
        )
        logger.info("[APP %s] Stage 1 complete — match_score=%d", app_id, analysis.match_score)

        # Update DB with Stage 1 results
        supa.table("job_applications").update({
            "match_score": analysis.match_score,
            "stage1_analysis": analysis.model_dump(),
            "status": "stage1_complete",
        }).eq("id", app_id).execute()

        # --- Stage 2: Creative rewrite ---
        logger.info("[APP %s] Stage 2: Rewriting resume content", app_id)
        # Extract first summary paragraph and bullets from resume markdown
        lines = resume_md.splitlines()
        summary_lines: list[str] = []
        bullet_lines: list[str] = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("- ") or stripped.startswith("* "):
                bullet_lines.append(stripped.lstrip("- *").strip())
            elif stripped and not stripped.startswith("#") and len(summary_lines) < 5:
                summary_lines.append(stripped)

        original_summary = " ".join(summary_lines[:3])
        experience_bullets = bullet_lines[:20]  # cap to avoid token overflow

        stage2_messages = [
            {"role": "system", "content": STAGE2_SYSTEM},
            {"role": "user", "content": build_stage2_user_message(
                original_summary, experience_bullets, analysis, company, role
            )},
        ]
        tailored: TailoredContent = client.chat.completions.create(
            model=settings.ollama_chat_model,
            messages=stage2_messages,
            response_model=TailoredContent,
            max_retries=3,
            temperature=0.3,
        )
        logger.info("[APP %s] Stage 2 complete", app_id)

        # --- Stage 3: Pure-Python document generation (NO LLM) ---
        logger.info("[APP %s] Stage 3: Generating DOCX/PDF", app_id)
        output_dir = tmpdir_path / "output"
        artifacts = render_tailored_resume(
            content=tailored,
            candidate_name=candidate_name,
            company=company,
            role=role,
            output_dir=output_dir,
        )

        # Upload artifacts to Supabase Storage
        docx_url: str | None = None
        pdf_url: str | None = None

        if artifacts["docx"] and Path(artifacts["docx"]).exists():
            storage_key = f"{user_id}/{app_id}/tailored_resume.docx"
            docx_url = _upload_to_supabase(
                supa, "tailored-resumes", storage_key, Path(artifacts["docx"])
            )

        if artifacts["pdf"] and Path(artifacts["pdf"]).exists():
            storage_key = f"{user_id}/{app_id}/tailored_resume.pdf"
            pdf_url = _upload_to_supabase(
                supa, "tailored-resumes", storage_key, Path(artifacts["pdf"])
            )

        # --- Final update ---
        supa.table("job_applications").update({
            "status": "ready",
            "stage2_content": tailored.model_dump(),
            "docx_url": docx_url,
            "pdf_url": pdf_url,
        }).eq("id", app_id).execute()

    logger.info("[APP %s] Pipeline complete. DOCX=%s, PDF=%s", app_id, docx_url, pdf_url)


# ---------------------------------------------------------------------------
# Main polling loop
# ---------------------------------------------------------------------------

def run_polling_loop(settings: Settings) -> None:
    """Poll Supabase for pending_processing rows and process them.

    Runs indefinitely. Each error is caught per-row so one bad row
    cannot crash the entire worker process.
    """
    settings.require_supabase()
    supa: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    logger.info(
        "Worker started — polling every %ds", settings.worker_poll_interval_seconds
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
                    process_resume(supa, settings, row)
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
                    process_document(supa, settings, row)
                except Exception:
                    pass  # already handled in process_document

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
                    process_job_application(supa, settings, row)
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
