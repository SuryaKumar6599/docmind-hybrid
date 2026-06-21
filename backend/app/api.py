"""FastAPI route handlers for DocMind local AI service.

Endpoints:
  GET  /health          — service health + dependency status
  GET  /                — API index
  POST /index           — index a document into the vector store
  POST /ask             — semantic search + RAG answer
  POST /extract-skills  — on-demand job-match gap analysis
  POST /convert         — convert any document to Markdown (no storage)
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import instructor
import requests
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openai import OpenAI
from pydantic import BaseModel

from .config import Settings, get_settings
from .document_processing import DocumentProcessor, chunk_text
from .models import AskRequest, AskResponse, HealthResponse, IndexResponse
from .ollama import OllamaClient
from .rag import LocalRAG
from .schemas import JobMatchAnalysis
from .supabase_store import SupabaseVectorStore

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

def get_ollama(settings: Settings = Depends(get_settings)) -> OllamaClient:
    return OllamaClient(settings)


def get_store(settings: Settings = Depends(get_settings)) -> SupabaseVectorStore:
    return SupabaseVectorStore(settings)


def get_instructor_client(settings: Settings = Depends(get_settings)) -> instructor.Instructor:
    raw = OpenAI(base_url=f"{settings.ollama_base_url}/v1", api_key="ollama")
    return instructor.from_openai(raw, mode=instructor.Mode.JSON)


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


@router.get("/")
async def root() -> dict[str, object]:
    return {
        "name": "DocMind Local AI Service",
        "version": "2.0.0",
        "status": "ok",
        "endpoints": {
            "health":         "GET  /health",
            "index":          "POST /index           multipart: file=<document>",
            "ask":            "POST /ask             JSON: {question, match_count, category?}",
            "extract-skills": "POST /extract-skills  JSON: {resume_text, jd_text}",
            "convert":        "POST /convert         multipart: file=<document>",
        },
    }


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

@router.post("/index", response_model=IndexResponse)
async def index_document(
    file: UploadFile = File(...),
    store: SupabaseVectorStore = Depends(get_store),
    ollama: OllamaClient = Depends(get_ollama),
) -> IndexResponse:
    """Chunk, embed, and store a document in the Supabase vector store."""
    filename = file.filename or "document"
    _validate_extension(filename)
    suffix = Path(filename).suffix.lower()

    logger.info("Indexing document: %s", filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(await file.read())
        temp_path = Path(temp.name)

    try:
        processor = DocumentProcessor(ollama_client=ollama)
        markdown = processor.convert_to_markdown(temp_path)

        if not markdown.strip():
            raise HTTPException(
                status_code=422,
                detail=f"No text could be extracted from '{filename}'. "
                       "The file may be empty or in an unsupported format.",
            )

        chunks = chunk_text(markdown, chunk_size=800, overlap=100)
        metadata = processor.metadata_for(temp_path, filename)
        document_id = store.create_document(filename, metadata, category="general")
        embeddings = [ollama.embedding(chunk) for chunk in chunks]
        store.insert_chunks(document_id, chunks, embeddings, metadata)

        logger.info("Indexed '%s': %d chunks", filename, len(chunks))
        return IndexResponse(document_id=document_id, document_name=filename, chunks=len(chunks))

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Index failed for '%s': %s", filename, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        temp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Ask / RAG
# ---------------------------------------------------------------------------

@router.post("/ask", response_model=AskResponse)
async def ask_question(
    body: AskRequest,
    store: SupabaseVectorStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    ollama: OllamaClient = Depends(get_ollama),
) -> AskResponse:
    """Semantic search + RAG answer over indexed documents."""
    logger.info(
        "Ask: question=%r | category=%s | k=%d",
        body.question[:80], body.category, body.match_count,
    )
    try:
        query_embedding = ollama.embedding(body.question)
        sources = store.match_documents(
            query_embedding, body.match_count, category=body.category
        )
        rag = LocalRAG(settings)
        answer, citations = rag.answer(body.question, sources)
        return AskResponse(answer=answer, citations=citations, sources=sources)
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
    ollama: OllamaClient = Depends(get_ollama),
) -> ConvertResponse:
    """Convert any supported document to clean Markdown.

    Supports: PDF, DOCX, PPTX, Excel, HTML, TXT, MD, CSV, JSON, XML,
              PNG, JPG, GIF, BMP, TIFF, WebP, ZIP.

    For scanned/image-only PDFs and image files, Vision OCR
    via qwen2.5vl is used automatically.
    """
    filename = file.filename or "document"
    _validate_extension(filename)
    suffix = Path(filename).suffix.lower()

    logger.info("Convert request: %s", filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        processor = DocumentProcessor(ollama_client=ollama)
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
