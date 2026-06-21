from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from markitdown import MarkItDown

from .cleaner import clean_pdf_text, clean_markdown as _clean_md

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .ollama import OllamaClient


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    if not text.strip():
        return []
    paragraphs = re.split(r"\n\s*\n+", text.strip())
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if current and len(current) + len(paragraph) + 2 > chunk_size:
            chunks.append(current.strip())
            current = f"{current[-overlap:]}\n\n{paragraph}" if overlap else paragraph
        else:
            current = f"{current}\n\n{paragraph}" if current else paragraph

    if current:
        chunks.append(current.strip())
    return chunks


class DocumentProcessor:
    def __init__(self, ollama_client: 'OllamaClient | None' = None) -> None:
        self.converter = MarkItDown()
        self.ollama_client = ollama_client

    def convert_to_markdown(self, file_path: str | Path) -> str:
        ext = Path(file_path).suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp") and self.ollama_client:
            raw = self.ollama_client.vision_ocr(str(file_path))
        else:
            result = self.converter.convert(str(file_path))
            raw = result.text_content or ""
            # If PDF returned empty text, it is likely a scanned/image-only PDF.
            # Fall back to per-page vision OCR.
            if not raw.strip() and ext == ".pdf" and self.ollama_client:
                raw = self._ocr_pdf_pages(file_path)
        # Apply robust PDF cleaner first, then markdown normalizer
        cleaned = clean_pdf_text(raw)
        return _clean_md(cleaned)

    def _ocr_pdf_pages(self, file_path: str | Path) -> str:
        """Extract text from a scanned PDF by rendering each page as an image
        and running vision OCR. Requires pymupdf (fitz) and an ollama_client."""
        import tempfile
        import importlib
        fitz = importlib.import_module("fitz")  # pymupdf
        doc = fitz.open(str(file_path))
        pages_text: list[str] = []
        with tempfile.TemporaryDirectory() as tmpdir:
            for page_num, page in enumerate(doc):
                # Render at 150 DPI — good quality without excessive memory
                mat = fitz.Matrix(150 / 72, 150 / 72)
                pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
                img_path = Path(tmpdir) / f"page_{page_num}.png"
                pix.save(str(img_path))
                page_text = self.ollama_client.vision_ocr(str(img_path))  # type: ignore[union-attr]
                if page_text.strip():
                    pages_text.append(f"<!-- Page {page_num + 1} -->\n{page_text}")
        return "\n\n".join(pages_text)

    @staticmethod
    def metadata_for(file_path: str | Path, original_name: str) -> dict[str, Any]:
        path = Path(file_path)
        return {
            "source_filename": original_name,
            "suffix": path.suffix.lower(),
            "size_bytes": path.stat().st_size if path.exists() else None,
        }
