"""Document Service — Ingestion and chunking logic."""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

from supabase import Client

from ..cleaner import clean_markdown
from ..config import Settings
from ..document_processing import DocumentProcessor, chunk_text
from ..llm_gateway import BaseChatProvider, BaseEmbeddingProvider
from ..supabase_store import SupabaseVectorStore

logger = logging.getLogger(__name__)


def _download_from_supabase(
    supa: Client, bucket: str, storage_path: str, local_path: Path
) -> None:
    """Download a file from Supabase Storage to a local temp path."""
    response = supa.storage.from_(bucket).download(storage_path)
    local_path.write_bytes(response)
    logger.info("Downloaded %s/%s → %s", bucket, storage_path, local_path)


def process_resume_ingestion(
    supa: Client,
    settings: Settings,
    chat_provider: BaseChatProvider,
    embedding_provider: BaseEmbeddingProvider,
    row: dict[str, Any],
) -> None:
    """Ingest a base resume into the Supabase vector store."""
    resume_id: str = row["id"]
    user_id: str = row["user_id"]
    storage_path: str = row["storage_path"]
    original_name: str = row.get("original_filename", "resume")

    with tempfile.TemporaryDirectory() as tmpdir:
        local_file = Path(tmpdir) / Path(storage_path).name
        _download_from_supabase(supa, "resumes", storage_path, local_file)

        processor = DocumentProcessor(chat_provider=chat_provider)
        raw_markdown = processor.convert_to_markdown(local_file)
        cleaned = clean_markdown(raw_markdown)

        store = SupabaseVectorStore(settings)

        doc_id = store.create_document(
            original_name,
            {"user_id": user_id, "category": "resume", "resume_id": resume_id},
            category="resume",
        )
        chunks = chunk_text(cleaned, chunk_size=600, overlap=80)
        embeddings = [embedding_provider.embed(chunk) for chunk in chunks]
        store.insert_chunks(doc_id, chunks, embeddings, {"category": "resume", "user_id": user_id})

        supa.table("resumes").update({
            "status": "ready",
            "document_id": doc_id,
            "markdown_content": cleaned,
            "chunk_count": len(chunks),
        }).eq("id", resume_id).execute()

    logger.info("[RESUME %s] Ingestion complete (%d chunks)", resume_id, len(chunks))


def process_general_document(
    supa: Client,
    settings: Settings,
    chat_provider: BaseChatProvider,
    embedding_provider: BaseEmbeddingProvider,
    row: dict[str, Any],
) -> None:
    """Ingest a general document into the Supabase vector store async."""
    doc_id: str = row["id"]
    storage_path: str = row["storage_path"]
    original_name: str = row.get("name", "document")

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            local_file = Path(tmpdir) / Path(storage_path).name
            _download_from_supabase(supa, "search-documents", storage_path, local_file)

            processor = DocumentProcessor(chat_provider=chat_provider)
            raw_markdown = processor.convert_to_markdown(local_file)

            if not raw_markdown.strip():
                raise ValueError(f"No text extracted from {original_name}")

            chunks = chunk_text(raw_markdown, chunk_size=800, overlap=100)
            embeddings = [embedding_provider.embed(chunk) for chunk in chunks]

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
        raise
