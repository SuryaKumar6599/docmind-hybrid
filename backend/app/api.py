"""FastAPI route handlers for DocMind local AI service.

Endpoints:
  GET  /health              — service health + dependency status
  GET  /                    — API index
  POST /index               — index a document into the vector store
  POST /ask                 — semantic search + RAG answer
  POST /extract-skills      — on-demand job-match gap analysis
  POST /convert             — convert any document to Markdown (no storage)
  POST /generate-tailored   — stage 2 creative rewrite (used by Intelligence UI)
  POST /export-docx         — render tailored resume as a .docx stream
"""
from __future__ import annotations

import logging
import tempfile
import uuid
from pathlib import Path

import instructor
import requests
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

import datetime as dt
import re

from .config import Settings, get_settings
from .document_processing import DocumentProcessor, chunk_text
from .llm_gateway import BaseChatProvider, BaseEmbeddingProvider, get_chat_provider, get_embedding_provider
from .models import (
    AskRequest,
    AskResponse,
    HealthFullResponse,
    HealthResponse,
    IndexResponse,
    OllamaHealth,
    SupabaseHealth,
    TunnelHealth,
)
from .rag import LocalRAG
from .schemas import JobMatchAnalysis, TailoredContent
from .supabase_store import SupabaseVectorStore
from .docx_renderer import render_tailored_resume
from .prompts import STAGE2_SYSTEM, build_stage2_user_message

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


# ---------------------------------------------------------------------------
# Dependency factories
# ---------------------------------------------------------------------------

def get_chat_provider_dep(settings: Settings = Depends(get_settings)) -> BaseChatProvider:
    return get_chat_provider(settings)

def get_embedding_provider_dep(settings: Settings = Depends(get_settings)) -> BaseEmbeddingProvider:
    return get_embedding_provider(settings)

def get_store(settings: Settings = Depends(get_settings)) -> SupabaseVectorStore:
    return SupabaseVectorStore(settings)

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
    model_status = {"chat": False, "vision": False, "embed": False}
    try:
        resp = requests.get(f"{settings.ollama_base_url}/api/tags", timeout=3)
        ollama_reachable = resp.ok
        if resp.ok:
            installed = {m.get("name", "") for m in resp.json().get("models", [])}
            model_status["chat"] = _model_installed(settings.ollama_chat_model, installed)
            model_status["vision"] = _model_installed(settings.ollama_vision_model, installed)
            model_status["embed"] = _model_installed(settings.ollama_embed_model, installed)
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
    models_ok = all(model_status.values())

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
            "index":             "POST /index              multipart: file=<document>",
            "ask":               "POST /ask                JSON: {question, match_count, category?}",
            "extract-skills":    "POST /extract-skills     JSON: {resume_text, jd_text}",
            "convert":           "POST /convert            multipart: file=<document>",
            "generate-tailored": "POST /generate-tailored  JSON: {resume_text, analysis, company, role}",
            "export-docx":       "POST /export-docx        JSON: {content, candidate_name, company, role} → .docx stream",
        },
    }


# ---------------------------------------------------------------------------
# Index (vector store)
# ---------------------------------------------------------------------------

@router.post("/index")
async def index_document(
    file: UploadFile = File(...),
    store: SupabaseVectorStore = Depends(get_store),
    chat_provider: BaseChatProvider = Depends(get_chat_provider_dep),
    embedding_provider: BaseEmbeddingProvider = Depends(get_embedding_provider_dep),
):
    """Convert a document to Markdown, chunk it, embed chunks, and upsert into Supabase."""
    filename = file.filename or "document"
    _validate_extension(filename)
    suffix = Path(filename).suffix.lower()
    logger.info("Index request: %s", filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        processor = DocumentProcessor(chat_provider=chat_provider)
        markdown = processor.convert_to_markdown(tmp_path)
        chunks: list[str] = chunk_text(markdown)

        if not chunks:
            raise HTTPException(status_code=422, detail="Document produced no extractable text.")

        # Create document record first, then embed + insert chunks in bulk.
        document_id = store.create_document(
            name=filename,
            metadata={"source": filename, "char_count": len(markdown)},
        )
        embeddings = [embedding_provider.embed(chunk) for chunk in chunks]
        store.insert_chunks(
            document_id=document_id,
            chunks=chunks,
            embeddings=embeddings,
            metadata={"filename": filename},
        )

        logger.info("Indexed %d chunks for '%s' (doc_id=%s)", len(chunks), filename, document_id)
        return {
            "document_id": document_id,
            "filename": filename,
            "chunk_count": len(chunks),
            "char_count": len(markdown),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Index failed for '%s': %s", filename, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Ask / RAG
# ---------------------------------------------------------------------------

@router.post("/ask")
async def ask_question(
    body: AskRequest,
    store: SupabaseVectorStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    chat_provider: BaseChatProvider = Depends(get_chat_provider_dep),
    embedding_provider: BaseEmbeddingProvider = Depends(get_embedding_provider_dep),
):
    """Semantic search + streaming RAG answer over indexed documents."""
    logger.info(
        "Ask: question=%r | category=%s | k=%d",
        body.question[:80], body.category, body.match_count,
    )
    try:
        query_embedding = embedding_provider.embed(body.question)
        sources = store.match_documents_hybrid(
            query_text=body.question,
            query_embedding=query_embedding,
            match_count=body.match_count,
            category=body.category
        )
        rag = LocalRAG(settings, chat_provider)
        return StreamingResponse(
            rag.answer_stream(body.question, sources),
            media_type="application/x-ndjson"
        )
    except Exception as exc:
        logger.error("Ask failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Skills extraction
# ---------------------------------------------------------------------------

_SKILLS_PROMPT = """\
Compare the RESUME and JOB DESCRIPTION below and return a structured gap analysis.

Focus on:
1. Keywords/technologies the JD requires that are ABSENT from the resume → missing_keywords
2. Skills present in BOTH documents → matched_skills
3. Overall 0-100 alignment score → match_score
4. Up to 3 portfolio projects from the resume that best demonstrate fit → recommended_projects
5. Candidate's 3-5 strongest selling points for this specific role → core_highlights
6. A concise 15-word pitch summarising the candidate's fit → one_line_pitch

### RESUME
{resume_text}

### JOB DESCRIPTION
{jd_text}
"""


class SkillsExtractionRequest(BaseModel):
    resume_text: str
    jd_text: str


@router.post("/extract-skills", response_model=JobMatchAnalysis)
async def extract_skills(
    body: SkillsExtractionRequest,
    settings: Settings = Depends(get_settings),
    client: instructor.Instructor = Depends(get_instructor_client),
) -> JobMatchAnalysis:
    """On-demand skills gap analysis from raw resume + JD text."""
    if not body.resume_text.strip():
        raise HTTPException(status_code=422, detail="resume_text must not be empty")
    if not body.jd_text.strip():
        raise HTTPException(status_code=422, detail="jd_text must not be empty")

    logger.info(
        "Skills extraction: resume=%d chars, jd=%d chars",
        len(body.resume_text), len(body.jd_text),
    )

    prompt = _SKILLS_PROMPT.format(
        resume_text=body.resume_text[:6000],
        jd_text=body.jd_text[:3000],
    )

    try:
        result: JobMatchAnalysis = client.chat.completions.create(
            model=settings.ollama_chat_model,
            response_model=JobMatchAnalysis,
            max_retries=3,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert ATS analyst. "
                        "Respond with valid JSON matching the requested schema exactly. "
                        "Do not hallucinate projects or skills not present in the resume."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        logger.info("Skills extraction complete: match_score=%d", result.match_score)
        return result
    except Exception as exc:
        logger.error("Skills extraction failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Skills extraction failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Convert (Markdown export — no storage)
# ---------------------------------------------------------------------------

class ConvertResponse(BaseModel):
    filename: str
    markdown: str
    char_count: int
    word_count: int
    estimated_tokens: int
    ocr_used: bool = False   # True when Vision OCR fallback was triggered


@router.post("/convert", response_model=ConvertResponse)
async def convert_document(
    file: UploadFile = File(...),
    chat_provider: BaseChatProvider = Depends(get_chat_provider_dep),
) -> ConvertResponse:
    """Convert any supported document to clean Markdown.

    Supports: PDF, DOCX, PPTX, Excel, HTML, TXT, MD, CSV, JSON, XML,
              PNG, JPG, GIF, BMP, TIFF, WebP, ZIP.

    For scanned/image-only PDFs and image files, Vision OCR
    is used automatically.
    """
    filename = file.filename or "document"
    _validate_extension(filename)
    suffix = Path(filename).suffix.lower()

    logger.info("Convert request: %s", filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        processor = DocumentProcessor(chat_provider=chat_provider)
        markdown = processor.convert_to_markdown(tmp_path)

        # Detect whether OCR was used (image file or scanned PDF fallback)
        is_image = suffix in {
            ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"
        }
        # If PDF produced output and starts with "<!-- Page" it went through OCR
        ocr_used = is_image or markdown.startswith("<!-- Page")

        logger.info(
            "Convert complete: %s → %d chars (ocr=%s)", filename, len(markdown), ocr_used
        )

        return ConvertResponse(
            filename=filename,
            markdown=markdown,
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

    lines = body.resume_text.splitlines()
    summary_lines: list[str] = []
    bullet_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            bullet_lines.append(stripped.lstrip("- *").strip())
        elif stripped and not stripped.startswith("#") and len(summary_lines) < 5:
            summary_lines.append(stripped)

    original_summary = " ".join(summary_lines[:3])
    experience_bullets = bullet_lines[:20]

    logger.info(
        "Generate tailored: resume=%d chars, company=%r, role=%r",
        len(body.resume_text), body.company, body.role,
    )

    stage2_messages = [
        {"role": "system", "content": STAGE2_SYSTEM},
        {"role": "user", "content": build_stage2_user_message(
            original_summary, experience_bullets, body.analysis, body.company, body.role
        )},
    ]

    try:
        tailored: TailoredContent = client.chat.completions.create(
            model=settings.ollama_chat_model,
            messages=stage2_messages,
            response_model=TailoredContent,
            max_retries=3,
            temperature=0.3,
        )
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
        # Read bytes to memory inside tempdir scope so the dir can safely be cleaned up.
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
