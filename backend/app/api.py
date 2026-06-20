from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from .config import Settings, get_settings
from .document_processing import DocumentProcessor, chunk_text
from .models import AskRequest, AskResponse, HealthResponse, IndexResponse
from .ollama import OllamaClient
from .rag import LocalRAG
from .supabase_store import SupabaseVectorStore

router = APIRouter()


def get_ollama(settings: Settings = Depends(get_settings)) -> OllamaClient:
    return OllamaClient(settings)


def get_store(settings: Settings = Depends(get_settings)) -> SupabaseVectorStore:
    return SupabaseVectorStore(settings)


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
            "index": "POST /index multipart/form-data file=<document>",
            "ask": "POST /ask JSON {question, match_count, category?}",
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
