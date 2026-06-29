"""Robust PDF/document text cleaner.

Fixes common PDF extraction artifacts before sending text to the LLM.
Each rule is documented with the artifact it targets.
Rules are applied in order — earlier rules may enable later ones.
"""
from __future__ import annotations

import re


def clean_pdf_text(text: str) -> str:
    """Apply a sequence of targeted regex fixes to raw PDF-extracted text."""

    # 1. Fix inter-letter spaces only for runs of 4+ single-letter tokens:
    #    "L a n g u a g e s" → "Languages"
    #    Uses a positive lookahead to require at least 3 consecutive pairs,
    #    avoiding false collapses of acronyms like "A B C" (2-letter runs).
    text = re.sub(
        r"\b([A-Za-z]) (?=[A-Za-z] [A-Za-z] [A-Za-z](?= [A-Za-z]|\b))",
        r"\1",
        text,
    )

    # 1b. Normalize ligature glyphs PDF extractors often leave undecoded:
    #     "ﬁelds" → "fields", "ﬂow" → "flow", "Insuﬃcient" → "Insufficient"
    text = (
        text.replace("\ufb00", "ff")
        .replace("\ufb01", "fi")
        .replace("\ufb02", "fl")
        .replace("\ufb03", "ffi")
        .replace("\ufb04", "ffl")
    )

    # 2. Fix escaped pipes from table extraction: "\|" → "|"
    text = text.replace(r"\|", "|")

    # 3. Fix hyphenated line-breaks: "demon-\nstrate" → "demonstrate"
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)

    # 4. Collapse multiple spaces/tabs into a single space (preserve newlines)
    text = re.sub(r"[ \t]{2,}", " ", text)

    # 5. Collapse 3+ consecutive blank lines to exactly two (one paragraph break)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # 6. Fix spacing before punctuation: "Hello , world" → "Hello, world"
    text = re.sub(r" ([,;:!?.])", r"\1", text)

    # 7. Fix missing space after sentence-ending punctuation followed by a capital
    text = re.sub(r"([.!?])([A-Z])", r"\1 \2", text)

    # 8. Remove PDF page-number artifacts: lines that are *only* a number
    text = re.sub(r"^\s*\d+\s*$", "", text, flags=re.MULTILINE)

    # 9. Fix curly/smart quotes to straight quotes (cleaner LLM tokenization)
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')

    # 10. Strip trailing whitespace from each line
    text = "\n".join(line.rstrip() for line in text.splitlines())

    return text.strip()


def clean_markdown(text: str) -> str:
    """Lightweight cleaner for already-converted Markdown (MarkItDown output)."""
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Collapse multiple spaces (not at line start — preserves code indentation)
    text = re.sub(r"(?<!^)[ \t]{2,}", " ", text, flags=re.MULTILINE)
    return text.strip()
