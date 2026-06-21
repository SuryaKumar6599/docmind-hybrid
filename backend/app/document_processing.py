"""Document processing — MarkItDown conversion + chunking.

Conversion pipeline:
  1. Image files (.png/.jpg/etc.)  → Ollama Vision OCR directly
  2. Normal PDFs / DOCX / PPTX    → MarkItDown (pdfminer backend)
  3. Scanned/image-only PDFs      → pymupdf page-render → Ollama Vision OCR per page
                                    (fallback when MarkItDown returns empty text)

Chunking:
  - Split on paragraph boundaries first (double newline)
  - Sub-split oversized paragraphs at sentence boundaries to avoid
    mid-sentence chunk cuts (improves RAG retrieval quality)
  - Overlap carries the last `overlap` chars into the next chunk
    to preserve cross-boundary context
"""
from __future__ import annotations

import logging
import re
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from markitdown import MarkItDown

from .cleaner import clean_pdf_text, clean_markdown as _clean_md

if TYPE_CHECKING:
    from .ollama import OllamaClient

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Image-file extensions handled by Vision OCR
# ---------------------------------------------------------------------------
_IMAGE_EXTS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp",
})

# Maximum pages to OCR in a single scanned PDF call (prevents timeout)
_MAX_OCR_PAGES = 20


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """Split *text* into overlapping chunks of at most *chunk_size* characters.

    Strategy:
    1. Split on paragraph boundaries (blank lines).
    2. If a paragraph is itself larger than chunk_size, sub-split at sentence
       boundaries ('. ', '! ', '? ') to avoid hard mid-word cuts.
    3. Accumulate paragraphs into a chunk; when full, emit and start new chunk
       with a `overlap`-char tail from the previous chunk to preserve context.
    """
    if not text.strip():
        return []

    # Step 1: paragraph split
    paragraphs = re.split(r"\n\s*\n+", text.strip())
    # Step 2: sub-split oversized paragraphs at sentence boundaries
    sentences: list[str] = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para) > chunk_size:
            # Split at sentence-ending punctuation followed by space
            parts = re.split(r"(?<=[.!?])\s+", para)
            sentences.extend(p.strip() for p in parts if p.strip())
        else:
            sentences.append(para)

    # Step 3: accumulate into chunks
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if current and len(current) + len(sentence) + 2 > chunk_size:
            chunks.append(current.strip())
            # Start next chunk with overlap tail for context continuity
            current = f"{current[-overlap:]}\n\n{sentence}" if overlap else sentence
        else:
            current = f"{current}\n\n{sentence}" if current else sentence

    if current.strip():
        chunks.append(current.strip())

    return chunks


# ---------------------------------------------------------------------------
# DocumentProcessor
# ---------------------------------------------------------------------------

class DocumentProcessor:
    """Convert any supported document to clean Markdown.

    Pass an `ollama_client` to enable Vision OCR for images and
    scanned PDF fallback.
    """

    def __init__(self, ollama_client: "OllamaClient | None" = None) -> None:
        self.converter = MarkItDown()
        self.ollama_client = ollama_client

    def convert_to_markdown(self, file_path: str | Path) -> str:
        """Convert *file_path* to clean Markdown text."""
        path = Path(file_path)
        ext = path.suffix.lower()

        if ext in _IMAGE_EXTS:
            if self.ollama_client:
                logger.info("Vision OCR: %s", path.name)
                raw = self.ollama_client.vision_ocr(str(path))
            else:
                logger.warning(
                    "No ollama_client — cannot OCR image %s; returning empty string", path.name
                )
                raw = ""
        else:
            logger.info("MarkItDown conversion: %s", path.name)
            try:
                result = self.converter.convert(str(path))
                raw = result.text_content or ""
            except Exception as exc:
                logger.error("MarkItDown failed for %s: %s", path.name, exc)
                raw = ""

            # Scanned PDF fallback: if MarkItDown returns nothing, try Vision OCR per page
            if not raw.strip() and ext == ".pdf":
                if self.ollama_client:
                    logger.info(
                        "MarkItDown returned empty text for %s — attempting scanned-PDF OCR",
                        path.name,
                    )
                    raw = self._ocr_pdf_pages(path)
                else:
                    logger.warning(
                        "No ollama_client for scanned PDF %s — returning empty string", path.name
                    )

        cleaned = clean_pdf_text(raw)
        result_md = _clean_md(cleaned)
        logger.info(
            "Conversion complete: %s → %d chars / ~%d tokens",
            path.name, len(result_md), len(result_md) // 4,
        )
        return result_md

    def _ocr_pdf_pages(self, file_path: Path) -> str:
        """Render each page of a scanned PDF as a PNG and run Vision OCR.

        Caps at _MAX_OCR_PAGES to prevent request timeouts.
        Requires pymupdf (pip install pymupdf) and self.ollama_client.
        """
        try:
            import fitz  # pymupdf
        except ImportError:
            logger.error(
                "pymupdf is not installed. Run: pip install pymupdf\n"
                "Cannot OCR scanned PDF: %s",
                file_path.name,
            )
            return ""

        doc = fitz.open(str(file_path))
        total_pages = len(doc)
        pages_to_ocr = min(total_pages, _MAX_OCR_PAGES)

        if total_pages > _MAX_OCR_PAGES:
            logger.warning(
                "Scanned PDF %s has %d pages; capping at %d to avoid timeout",
                file_path.name, total_pages, _MAX_OCR_PAGES,
            )

        pages_text: list[str] = []
        with tempfile.TemporaryDirectory() as tmpdir:
            for page_num in range(pages_to_ocr):
                page = doc[page_num]
                # 150 DPI — good OCR quality without excessive memory
                mat = fitz.Matrix(150 / 72, 150 / 72)
                pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
                img_path = Path(tmpdir) / f"page_{page_num}.png"
                pix.save(str(img_path))
                logger.info("OCR page %d/%d of %s", page_num + 1, pages_to_ocr, file_path.name)
                try:
                    page_text = self.ollama_client.vision_ocr(str(img_path))  # type: ignore[union-attr]
                    if page_text.strip():
                        pages_text.append(f"<!-- Page {page_num + 1} -->\n{page_text}")
                except Exception as exc:
                    logger.error("Vision OCR failed for page %d of %s: %s", page_num + 1, file_path.name, exc)

        return "\n\n".join(pages_text)

    @staticmethod
    def metadata_for(file_path: str | Path, original_name: str) -> dict[str, Any]:
        """Return file metadata for storage in Supabase."""
        path = Path(file_path)
        return {
            "source_filename": original_name,
            "suffix": path.suffix.lower(),
            "size_bytes": path.stat().st_size if path.exists() else None,
        }
