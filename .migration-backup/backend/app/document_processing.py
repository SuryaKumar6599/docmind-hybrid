from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from markitdown import MarkItDown


def clean_markdown(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


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
    def __init__(self) -> None:
        self.converter = MarkItDown()

    def convert_to_markdown(self, file_path: str | Path) -> str:
        result = self.converter.convert(str(file_path))
        return clean_markdown(result.text_content or "")

    @staticmethod
    def metadata_for(file_path: str | Path, original_name: str) -> dict[str, Any]:
        path = Path(file_path)
        return {
            "source_filename": original_name,
            "suffix": path.suffix.lower(),
            "size_bytes": path.stat().st_size if path.exists() else None,
        }
