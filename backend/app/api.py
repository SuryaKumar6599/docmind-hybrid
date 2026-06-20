from __future__ import annotations

import tempfile
from pathlib import Path

import instructor
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

router = APIRouter()


def get_ollama(settings: Settings = Depends(get_settings)) -> OllamaClient:
    return OllamaClient(settings)


def get_store(settings: Settings = Depends(get_settings)) -> SupabaseVectorStore:
    return SupabaseVectorStore(settings)


def get_instructor_client(settings: Settings = Depends(get_settings)) -> instructor.Instructor:
    raw = OpenAI(base_url=f"{settings.ollama_base_url}/v1", api_key="ollama")
    return instructor.from_openai(raw, mode=instructor.Mode.JSON)


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", runtime="local-fastapi-ollama-v2")


@router.get("/")
async def root() -> dict[str, object]:
    return {
        "name": "DocMind Local AI Service",
        "version": "2.0.0",
        "status": "ok",
        "endpoints": {
            "index":          "POST /index           multipart: file=<document>",
            "ask":            "POST /ask             JSON: {question, match_count, category?}",
            "extract-skills": "POST /extract-skills  JSON: {resume_text, jd_text}",
        },
    }


@router.post("/index", response_model=IndexResponse)
async def index_document(
    file: UploadFile = File(...),
    store: SupabaseVectorStore = Depends(get_store),
    ollama: OllamaClient = Depends(get_ollama),
) -> IndexResponse:
    filename = file.filename or "document"
    suffix = Path(filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(await file.read())
        temp_path = Path(temp.name)

    try:
        processor = DocumentProcessor()
        markdown = processor.convert_to_markdown(temp_path)
        chunks = chunk_text(markdown, chunk_size=800, overlap=100)
        metadata = processor.metadata_for(temp_path, filename)
        document_id = store.create_document(filename, metadata, category="general")
        embeddings = [ollama.embedding(chunk) for chunk in chunks]
        store.insert_chunks(document_id, chunks, embeddings, metadata)
        return IndexResponse(document_id=document_id, document_name=filename, chunks=len(chunks))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        temp_path.unlink(missing_ok=True)


@router.post("/ask", response_model=AskResponse)
async def ask_question(
    body: AskRequest,
    store: SupabaseVectorStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    ollama: OllamaClient = Depends(get_ollama),
) -> AskResponse:
    try:
        query_embedding = ollama.embedding(body.question)
        sources = store.match_documents(
            query_embedding, body.match_count, category=body.category
        )
        rag = LocalRAG(settings)
        answer, citations = rag.answer(body.question, sources)
        return AskResponse(answer=answer, citations=citations, sources=sources)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Skills extraction — on-demand Stage 1 analysis (no Supabase required)
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
    """
    On-demand skills gap analysis from raw resume + JD text.

    Returns JobMatchAnalysis JSON:
      missing_keywords     — skills required by JD but absent from resume
      matched_skills       — skills present in both
      match_score          — 0-100 alignment score
      recommended_projects — up to 3 portfolio projects that best fit the role
      core_highlights      — candidate's top selling points for this role
      one_line_pitch       — 15-word summary of fit
    """
    if not body.resume_text.strip():
        raise HTTPException(status_code=422, detail="resume_text must not be empty")
    if not body.jd_text.strip():
        raise HTTPException(status_code=422, detail="jd_text must not be empty")

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
                        "Respond with valid JSON matching the requested schema exactly."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Skills extraction failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Markdown conversion — Microsoft MarkItDown on any document
# ---------------------------------------------------------------------------

class ConvertResponse(BaseModel):
    filename: str
    markdown: str
    char_count: int
    word_count: int
    estimated_tokens: int


@router.post("/convert", response_model=ConvertResponse)
async def convert_document(file: UploadFile = File(...)) -> ConvertResponse:
    """
    Convert any document (PDF, DOCX, PPTX, Excel, HTML, images, TXT…) to clean Markdown.
    Uses Microsoft MarkItDown. Returns markdown text + stats for token budget planning.

    Supported formats: PDF, DOCX, PPTX, XLSX, HTML, TXT, MD, CSV, JSON, XML,
                       PNG, JPG, GIF, BMP, TIFF, WebP (via vision OCR)
    """
    filename = file.filename or "document"
    suffix = Path(filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)
    try:
        processor = DocumentProcessor()
        markdown = processor.convert_to_markdown(tmp_path)
        return ConvertResponse(
            filename=filename,
            markdown=markdown,
            char_count=len(markdown),
            word_count=len(markdown.split()),
            estimated_tokens=len(markdown) // 4,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)
