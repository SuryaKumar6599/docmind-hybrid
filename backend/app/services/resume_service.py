"""Resume Service — Handles Resume Analysis and Tailoring."""
from __future__ import annotations

import datetime as dt
import logging
import tempfile
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from supabase import Client

from ..cleaner import clean_markdown
from ..config import Settings
from ..context_manager import allocate_budget
from ..document_processing import DocumentProcessor
from ..docx_renderer import render_tailored_resume
from ..llm_gateway import BaseChatProvider, BaseEmbeddingProvider
from ..prompts import (
    STAGE1_SYSTEM,
    STAGE2_SYSTEM,
    build_stage1_user_message,
    build_stage2_user_message,
)
from ..schemas import JobMatchAnalysis, TailoredContent

logger = logging.getLogger(__name__)


def _with_status_date(row: dict[str, Any], status: str) -> dict[str, str]:
    dates = dict(row.get("status_dates") or {})
    dates[status] = dt.date.today().isoformat()
    return dates


# ---------------------------------------------------------------------------
# Strict Resume Analysis Output Schema (Instructor-enforced)
# ---------------------------------------------------------------------------

class ResumeAnalysis(BaseModel):
    match_score: float = Field(..., description="Overall alignment score from 0 to 100")
    missing_skills: list[str] = Field(..., description="Key skills required by JD but missing from resume")
    strong_skills: list[str] = Field(..., description="Key skills present in both JD and resume")
    ats_recommendations: list[str] = Field(..., description="Actionable recommendations to improve ATS pass rate")


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


def process_tailoring(
    supa: Client,
    settings: Settings,
    chat_provider: BaseChatProvider,
    embedding_provider: BaseEmbeddingProvider,
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

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)

        # --- Fetch base resume markdown ---
        resume_row = supa.table("resumes").select("markdown_content, original_filename").eq("id", resume_id).single().execute()
        resume_md: str = resume_row.data["markdown_content"]
        candidate_name: str = resume_row.data.get("original_filename", "Candidate").replace(".pdf", "").replace(".docx", "")

        # --- Download & convert JD ---
        jd_file = tmpdir_path / Path(jd_storage_path).name
        _download_from_supabase(supa, "job-descriptions", jd_storage_path, jd_file)
        processor = DocumentProcessor(chat_provider=chat_provider)
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

        instructor_client = chat_provider.get_instructor_client()

        # --- Stage 1: Analytical gap analysis ---
        logger.info("[APP %s] Stage 1: Gap analysis", app_id)
        stage1_messages = [
            {"role": "system", "content": STAGE1_SYSTEM},
            {"role": "user", "content": build_stage1_user_message(
                budgeted.jd, budgeted.resume, company, role
            )},
        ]
        
        analysis: JobMatchAnalysis = instructor_client.chat.completions.create(
            model=settings.ollama_chat_model,
            messages=stage1_messages,
            response_model=JobMatchAnalysis,
            max_retries=3,
            temperature=0.0,
        )
        logger.info("[APP %s] Stage 1 complete — match_score=%d", app_id, analysis.match_score)

        # Update DB with Stage 1 results
        row["status_dates"] = _with_status_date(row, "stage1_complete")
        supa.table("job_applications").update({
            "match_score": analysis.match_score,
            "stage1_analysis": analysis.model_dump(),
            "status": "stage1_complete",
            "status_dates": row["status_dates"],
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
        tailored: TailoredContent = instructor_client.chat.completions.create(
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
        row["status_dates"] = _with_status_date(row, "ready")
        supa.table("job_applications").update({
            "status": "ready",
            "status_dates": row["status_dates"],
            "stage2_content": tailored.model_dump(),
            "docx_url": docx_url,
            "pdf_url": pdf_url,
        }).eq("id", app_id).execute()

    logger.info("[APP %s] Pipeline complete. DOCX=%s, PDF=%s", app_id, docx_url, pdf_url)
