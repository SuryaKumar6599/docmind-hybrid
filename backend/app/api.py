"""FastAPI route handlers for DocMind local AI service.

Endpoints:
  GET  /health              — service health + dependency status
  GET  /health/full         — detailed: ollama, models, supabase, tunnel
  GET  /                    — API index
  POST /convert             — convert any document to Markdown + XML (no storage)
  POST /extract-skills      — on-demand job-match gap analysis
  POST /generate-tailored   — stage 2 creative rewrite
  POST /export-docx         — render tailored resume as a .docx stream
"""
from __future__ import annotations

import logging
import tempfile
import uuid
from pathlib import Path

import instructor
import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

import datetime as dt
import re
import difflib

from .config import Settings, get_settings
from .document_processing import DocumentProcessor
from .llm_gateway import BaseChatProvider, get_chat_provider
from .markdown_to_xml import markdown_to_xml
from .models import (
    HealthFullResponse,
    HealthResponse,
    OllamaHealth,
    SupabaseHealth,
    TunnelHealth,
)
from .schemas import JobMatchAnalysis, TailoredContent
from .docx_renderer import render_tailored_resume
from .prompts import STAGE1_SYSTEM, STAGE2_SYSTEM, build_stage1_user_message, build_stage2_user_message

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Allowed upload MIME / extension sets
# ---------------------------------------------------------------------------
_ALLOWED_EXTS = frozenset({
    ".pdf", ".docx", ".pptx", ".xlsx", ".xls",
    ".html", ".htm", ".txt", ".md", ".csv", ".json", ".xml",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp",
    ".zip",
})


def _validate_extension(filename: str) -> None:
    """Raise HTTP 422 if the file extension is not in the allow-list."""
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unsupported file type '{ext}'. "
                f"Supported: {', '.join(sorted(_ALLOWED_EXTS))}"
            ),
        )


def _validate_size(data: bytes, settings: Settings, filename: str) -> None:
    """Raise HTTP 413 if the uploaded file exceeds the configured limit."""
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"'{filename}' is {len(data) / (1024 * 1024):.1f} MB, "
                f"which exceeds the {settings.max_upload_size_mb} MB limit."
            ),
        )


# ---------------------------------------------------------------------------
# Dependency factories
# ---------------------------------------------------------------------------

def get_chat_provider_dep(settings: Settings = Depends(get_settings)) -> BaseChatProvider:
    return get_chat_provider(settings)

def get_instructor_client(chat_provider: BaseChatProvider = Depends(get_chat_provider_dep)) -> instructor.Instructor:
    return chat_provider.get_instructor_client()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse)
async def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    """Return service status. Pings Ollama to verify connectivity."""
    ollama_ok = False
    try:
        resp = requests.get(f"{settings.ollama_base_url}/api/tags", timeout=3)
        ollama_ok = resp.ok
    except Exception as exc:
        logger.warning("Ollama health-check failed: %s", exc)

    status = "ok" if ollama_ok else "degraded"
    logger.info("/health → %s (ollama=%s)", status, ollama_ok)
    return HealthResponse(status=status, runtime="local-fastapi-ollama-v2")


_TUNNEL_URL_PATTERN = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")


def _latest_tunnel_url() -> str | None:
    """Read the most recent quick-tunnel URL cloudflared printed to logs/tunnel.log."""
    log_path = Path(__file__).resolve().parents[2] / "logs" / "tunnel.log"
    if not log_path.exists():
        return None
    try:
        matches = _TUNNEL_URL_PATTERN.findall(log_path.read_text(errors="ignore"))
    except Exception:
        return None
    return matches[-1] if matches else None


def _model_installed(wanted: str, installed: set[str]) -> bool:
    """Match an exact Ollama tag, or fall back to comparing base names so a
    ':latest' pull still satisfies a request for e.g. 'qwen2.5:7b'."""
    if wanted in installed:
        return True
    base_wanted = wanted.split(":")[0]
    return any(name.split(":")[0] == base_wanted for name in installed)


@router.get("/health/full", response_model=HealthFullResponse)
async def health_full(settings: Settings = Depends(get_settings)) -> HealthFullResponse:
    """Detailed status for the debug panel: Ollama + required models, Supabase, tunnel."""
    ollama_reachable = False
    model_status = {"chat": False, "vision": False, "premium_chat": False}
    try:
        resp = requests.get(f"{settings.ollama_base_url}/api/tags", timeout=3)
        ollama_reachable = resp.ok
        if resp.ok:
            installed = {m.get("name", "") for m in resp.json().get("models", [])}
            model_status["chat"] = _model_installed(settings.ollama_chat_model, installed)
            model_status["vision"] = _model_installed(settings.ollama_vision_model, installed)
            model_status["premium_chat"] = _model_installed(settings.ollama_premium_chat_model, installed)
    except Exception as exc:
        logger.warning("Ollama health-check failed: %s", exc)

    supabase_configured = bool(settings.supabase_url and settings.supabase_service_role_key)
    supabase_reachable = False
    if supabase_configured:
        try:
            resp = requests.get(
                f"{settings.supabase_url}/auth/v1/health",
                headers={"apikey": settings.supabase_service_role_key},
                timeout=3,
            )
            supabase_reachable = resp.ok
        except Exception as exc:
            logger.warning("Supabase health-check failed: %s", exc)

    tunnel_url = _latest_tunnel_url()
    # premium_chat is supplementary (Stage 2 tailoring only) — its absence
    # shouldn't mark the whole app "degraded" the way a missing core model would.
    models_ok = all(v for k, v in model_status.items() if k != "premium_chat")

    if ollama_reachable and models_ok and supabase_reachable:
        overall = "ok"
    elif not ollama_reachable and not supabase_reachable:
        overall = "down"
    else:
        overall = "degraded"

    logger.info(
        "/health/full → %s (ollama=%s models=%s supabase=%s tunnel=%s)",
        overall, ollama_reachable, model_status, supabase_reachable, tunnel_url is not None,
    )

    return HealthFullResponse(
        status=overall,
        runtime="local-fastapi-ollama-v2",
        checked_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        fastapi=True,
        ollama=OllamaHealth(reachable=ollama_reachable, models=model_status),
        supabase=SupabaseHealth(configured=supabase_configured, reachable=supabase_reachable),
        tunnel=TunnelHealth(known=tunnel_url is not None, url=tunnel_url),
    )


@router.get("/")
async def root() -> dict[str, object]:
    return {
        "name": "DocMind Local AI Service",
        "version": "2.0.0",
        "status": "ok",
        "endpoints": {
            "health":            "GET  /health",
            "health-full":       "GET  /health/full         detailed: ollama, models, supabase, tunnel",
            "extract-skills":    "POST /extract-skills     JSON: {resume_text, jd_text}",
            "convert":           "POST /convert            multipart: file=<document>",
            "generate-tailored": "POST /generate-tailored  JSON: {resume_text, analysis, company, role}",
            "export-docx":       "POST /export-docx        JSON: {content, candidate_name, company, role} → .docx stream",
        },
    }


# ---------------------------------------------------------------------------
# Skills extraction
# ---------------------------------------------------------------------------

def _reconcile_keyword_contradictions(analysis: JobMatchAnalysis, resume_text: str) -> JobMatchAnalysis:
    """Deterministic safety net: a keyword can never be both matched and
    missing. If something in missing_keywords is literally findable in the
    resume text (case-insensitive, whitespace-normalized), it isn't actually
    missing -- move it to matched_skills."""
    resume_normalized = re.sub(r"\s+", " ", resume_text).lower()
    still_missing: list[str] = []
    matched = list(analysis.matched_skills)
    moved: list[str] = []

    for kw in analysis.missing_keywords:
        kw_normalized = re.sub(r"\s+", " ", kw).strip().lower()
        if kw_normalized and kw_normalized in resume_normalized:
            if kw not in matched:
                matched.append(kw)
                moved.append(kw)
        else:
            still_missing.append(kw)

    if moved:
        logger.info("Reconciled %d keyword(s) found in resume but flagged missing: %s", len(moved), moved)

    return analysis.model_copy(update={"missing_keywords": still_missing, "matched_skills": matched})


class SkillsExtractionRequest(BaseModel):
    resume_text: str
    jd_text: str = ""
    jd_url: str = ""
    company: str = ""
    role: str = ""


@router.post("/extract-skills", response_model=JobMatchAnalysis)
async def extract_skills(
    body: SkillsExtractionRequest,
    settings: Settings = Depends(get_settings),
    client: instructor.Instructor = Depends(get_instructor_client),
) -> JobMatchAnalysis:
    """On-demand skills gap analysis from raw resume + JD text."""
    if not body.resume_text.strip():
        raise HTTPException(status_code=422, detail="resume_text must not be empty")
        
    jd_text_resolved = body.jd_text.strip()
    
    if not jd_text_resolved and body.jd_url.strip():
        try:
            logger.info("Fetching JD text from URL: %s", body.jd_url)
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Connection": "keep-alive",
            }
            resp = requests.get(body.jd_url.strip(), timeout=25, headers=headers)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.content, "html.parser")
            # Extract text, separating elements with a space
            jd_text_resolved = soup.get_text(separator=" ", strip=True)
        except Exception as e:
            logger.warning("Failed to fetch/parse JD URL %s: %s", body.jd_url, e)
            raise HTTPException(status_code=422, detail=f"Failed to extract text from JD URL: {e}")

    if not jd_text_resolved:
        raise HTTPException(status_code=422, detail="jd_text or jd_url must not be empty")

    logger.info(
        "Skills extraction: resume=%d chars, jd=%d chars",
        len(body.resume_text), len(jd_text_resolved),
    )

    user_message = build_stage1_user_message(
        compressed_jd=jd_text_resolved[:3000],
        compressed_resume=body.resume_text[:6000],
        company=body.company,
        role=body.role,
    )

    try:
        result: JobMatchAnalysis = client.chat.completions.create(
            model=settings.ollama_chat_model,
            response_model=JobMatchAnalysis,
            max_retries=3,
            messages=[
                {"role": "system", "content": STAGE1_SYSTEM},
                {"role": "user", "content": user_message},
            ],
            temperature=0.1,
        )
        result = _reconcile_keyword_contradictions(result, body.resume_text)
        logger.info("Skills extraction complete: match_score=%d", result.match_score)
        return result
    except Exception as exc:
        logger.error("Skills extraction failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Skills extraction failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Convert (Markdown + XML export — no storage)
# ---------------------------------------------------------------------------

class ConvertResponse(BaseModel):
    filename: str
    markdown: str
    xml: str
    char_count: int
    word_count: int
    estimated_tokens: int
    ocr_used: bool = False   # True when Vision OCR fallback was triggered


@router.post("/convert", response_model=ConvertResponse)
async def convert_document(
    file: UploadFile = File(...),
    chat_provider: BaseChatProvider = Depends(get_chat_provider_dep),
    settings: Settings = Depends(get_settings),
) -> ConvertResponse:
    """Convert any supported document to clean Markdown and XML.

    Supports: PDF, DOCX, PPTX, Excel, HTML, TXT, MD, CSV, JSON, XML,
              PNG, JPG, GIF, BMP, TIFF, WebP, ZIP.

    For scanned/image-only PDFs and image files, Vision OCR
    is used automatically.
    """
    filename = file.filename or "document"
    _validate_extension(filename)
    suffix = Path(filename).suffix.lower()

    logger.info("Convert request: %s", filename)

    data = await file.read()
    _validate_size(data, settings, filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        processor = DocumentProcessor(chat_provider=chat_provider)
        markdown = processor.convert_to_markdown(tmp_path)

        is_image = suffix in {
            ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"
        }
        ocr_used = is_image or markdown.startswith("<!-- Page")

        logger.info(
            "Convert complete: %s → %d chars (ocr=%s)", filename, len(markdown), ocr_used
        )

        return ConvertResponse(
            filename=filename,
            markdown=markdown,
            xml=markdown_to_xml(markdown, source_filename=filename),
            char_count=len(markdown),
            word_count=len(markdown.split()),
            estimated_tokens=len(markdown) // 4,
            ocr_used=ocr_used,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Convert failed for '%s': %s", filename, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Interactive Tailoring UI Endpoints
# ---------------------------------------------------------------------------

class GenerateTailoredRequest(BaseModel):
    resume_text: str
    analysis: JobMatchAnalysis
    company: str
    role: str


_BULLET_PREFIX_RE = re.compile(r"^[-*•▪◦‣·]\s+|^\d+[.)]\s+")


def _extract_summary_and_bullets(resume_text: str) -> tuple[str, list[str]]:
    """Split resume Markdown into a rough summary + experience bullets."""
    summary_lines: list[str] = []
    bullet_lines: list[str] = []
    for line in resume_text.splitlines():
        stripped = line.strip()
        bullet_match = _BULLET_PREFIX_RE.match(stripped)
        if bullet_match:
            bullet_lines.append(stripped[bullet_match.end():].strip())
        elif stripped and not stripped.startswith("#") and len(summary_lines) < 5:
            summary_lines.append(stripped)
    return " ".join(summary_lines[:3]), bullet_lines[:20]


def _log_bullet_fidelity(tailored: TailoredContent, source_bullets: list[str]) -> None:
    """Log a warning when a rewritten bullet's 'original' field doesn't
    closely match anything actually extracted from the resume."""
    if not source_bullets:
        return
    for bullet in tailored.rewritten_bullets:
        best_ratio = max(
            difflib.SequenceMatcher(None, bullet.original.lower(), src.lower()).ratio()
            for src in source_bullets
        )
        if best_ratio < 0.5:
            logger.warning(
                "Low-fidelity 'original' bullet (best match %.0f%% vs resume): %r",
                best_ratio * 100, bullet.original[:80],
            )


@router.post("/generate-tailored", response_model=TailoredContent)
async def generate_tailored(
    body: GenerateTailoredRequest,
    settings: Settings = Depends(get_settings),
    client: instructor.Instructor = Depends(get_instructor_client),
) -> TailoredContent:
    """Stage 2: Generate rewritten summary and bullets based on Stage 1 analysis."""
    if not body.resume_text.strip():
        raise HTTPException(status_code=422, detail="resume_text must not be empty")
    if not body.company.strip():
        raise HTTPException(status_code=422, detail="company must not be empty")
    if not body.role.strip():
        raise HTTPException(status_code=422, detail="role must not be empty")

    original_summary, experience_bullets = _extract_summary_and_bullets(body.resume_text)

    logger.info(
        "Generate tailored: resume=%d chars, company=%r, role=%r, bullets_found=%d",
        len(body.resume_text), body.company, body.role, len(experience_bullets),
    )

    stage2_messages = [
        {"role": "system", "content": STAGE2_SYSTEM},
        {"role": "user", "content": build_stage2_user_message(
            original_summary, experience_bullets, body.analysis, body.company, body.role
        )},
    ]

    try:
        tailored: TailoredContent = client.chat.completions.create(
            model=settings.ollama_premium_chat_model,
            messages=stage2_messages,
            response_model=TailoredContent,
            max_retries=3,
            temperature=0.3,
        )
        _log_bullet_fidelity(tailored, experience_bullets)
        logger.info("Generate tailored complete for %r at %r", body.role, body.company)
        return tailored
    except Exception as exc:
        logger.error("Generate tailored failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ExportDocxRequest(BaseModel):
    content: TailoredContent
    candidate_name: str
    company: str
    role: str


@router.post("/export-docx")
async def export_docx(body: ExportDocxRequest):
    """Stage 3: Render TailoredContent into a DOCX file and stream it to the browser."""
    if not body.candidate_name.strip():
        raise HTTPException(status_code=422, detail="candidate_name must not be empty")
    if not body.company.strip():
        raise HTTPException(status_code=422, detail="company must not be empty")
    if not body.role.strip():
        raise HTTPException(status_code=422, detail="role must not be empty")

    logger.info("Export DOCX: candidate=%r, company=%r, role=%r",
                body.candidate_name, body.company, body.role)
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir)
            artifacts = render_tailored_resume(
                content=body.content,
                candidate_name=body.candidate_name,
                company=body.company,
                role=body.role,
                output_dir=out_dir,
            )
            docx_path = artifacts.get("docx")
            if not docx_path or not Path(docx_path).exists():
                raise RuntimeError("render_tailored_resume did not produce a DOCX file")
            file_bytes = Path(docx_path).read_bytes()

        safe_company = body.company.replace(" ", "_").replace("/", "-")
        filename = f"Tailored_Resume_{safe_company}.docx"
        return StreamingResponse(
            iter([file_bytes]),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Export DOCX failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
