"""Document Service — Resume ingestion (markdown conversion only)."""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

from supabase import Client

from ..cleaner import clean_markdown
from ..document_processing import DocumentProcessor
from ..llm_gateway import BaseChatProvider

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
    settings: Any,
    chat_provider: BaseChatProvider,
    row: dict[str, Any],
) -> None:
    """Convert a base resume to Markdown and persist it.

    Embedding has been removed — this function only converts the file
    and writes markdown_content + status=ready back to the resumes table.
    """
    resume_id: str = row["id"]
    storage_path: str = row["storage_path"]

    with tempfile.TemporaryDirectory() as tmpdir:
        local_file = Path(tmpdir) / Path(storage_path).name
        _download_from_supabase(supa, "resumes", storage_path, local_file)

        processor = DocumentProcessor(chat_provider=chat_provider)
        raw_markdown = processor.convert_to_markdown(local_file)
        cleaned = clean_markdown(raw_markdown)

        supa.table("resumes").update({
            "status": "ready",
            "markdown_content": cleaned,
        }).eq("id", resume_id).execute()

    logger.info("[RESUME %s] Ingestion complete (%d chars)", resume_id, len(cleaned))
