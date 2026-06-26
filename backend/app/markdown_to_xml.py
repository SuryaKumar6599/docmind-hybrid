"""Converts the already-extracted Markdown into a structured XML document.

Deliberately reuses the single Markdown extraction MarkItDown/Vision OCR
already produces, rather than running a second extraction pipeline for XML.
That keeps one source of truth: if the Markdown is right, the XML is right.

Uses only the standard library (re, xml.etree, xml.dom.minidom) — no new
dependency, per the project's "no new tech unless required" principle.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from xml.dom import minidom

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_UL_RE = re.compile(r"^[-*+]\s+(.*)$")
_OL_RE = re.compile(r"^\d+[.)]\s+(.*)$")
_TABLE_ROW_RE = re.compile(r"^\|(.+)\|$")
_TABLE_SEP_RE = re.compile(r"^\|?[\s:|-]+\|?$")
_CODE_FENCE_RE = re.compile(r"^```(\w*)\s*$")


def markdown_to_xml(markdown_text: str, source_filename: str = "document") -> str:
    """Parse Markdown structure (headings, paragraphs, lists, tables, code
    fences, blockquotes) into a simple XML tree, then pretty-print it.

    This is a line-based structural parser, not a full CommonMark parser —
    it's intentionally scoped to the subset of Markdown MarkItDown/cleaner
    actually produce. Anything it doesn't recognize falls through to a
    plain <paragraph>, so no content is ever dropped.
    """
    root = ET.Element("document", attrib={"source": source_filename})
    lines = markdown_text.splitlines()
    n = len(lines)
    i = 0

    paragraph_buffer: list[str] = []
    current_list: ET.Element | None = None
    current_list_type: str | None = None

    def flush_paragraph() -> None:
        if paragraph_buffer:
            text = " ".join(paragraph_buffer).strip()
            if text:
                p = ET.SubElement(root, "paragraph")
                p.text = text
            paragraph_buffer.clear()

    def close_list() -> None:
        nonlocal current_list, current_list_type
        current_list = None
        current_list_type = None

    while i < n:
        stripped = lines[i].strip()

        # Blank line: ends the current paragraph/list
        if not stripped:
            flush_paragraph()
            close_list()
            i += 1
            continue

        # Fenced code block
        fence_match = _CODE_FENCE_RE.match(stripped)
        if fence_match:
            flush_paragraph()
            close_list()
            lang = fence_match.group(1)
            code_lines: list[str] = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            code_el = ET.SubElement(root, "code")
            if lang:
                code_el.set("language", lang)
            code_el.text = "\n".join(code_lines)
            i += 1  # skip the closing fence
            continue

        # ATX heading
        heading_match = _HEADING_RE.match(stripped)
        if heading_match:
            flush_paragraph()
            close_list()
            h = ET.SubElement(root, "heading", attrib={"level": str(len(heading_match.group(1)))})
            h.text = heading_match.group(2).strip()
            i += 1
            continue

        # Table: a "| a | b |" row immediately followed by a "|---|---|" separator
        if _TABLE_ROW_RE.match(stripped) and i + 1 < n and _TABLE_SEP_RE.match(lines[i + 1].strip()):
            flush_paragraph()
            close_list()
            table_el = ET.SubElement(root, "table")
            header_row = ET.SubElement(table_el, "row", attrib={"header": "true"})
            for cell in (c.strip() for c in stripped.strip("|").split("|")):
                ET.SubElement(header_row, "cell").text = cell
            i += 2  # skip header + separator line
            while i < n and _TABLE_ROW_RE.match(lines[i].strip()):
                row_el = ET.SubElement(table_el, "row")
                for cell in (c.strip() for c in lines[i].strip().strip("|").split("|")):
                    ET.SubElement(row_el, "cell").text = cell
                i += 1
            continue

        # Unordered list item
        ul_match = _UL_RE.match(stripped)
        if ul_match:
            flush_paragraph()
            if current_list_type != "unordered":
                close_list()
                current_list = ET.SubElement(root, "list", attrib={"type": "unordered"})
                current_list_type = "unordered"
            ET.SubElement(current_list, "item").text = ul_match.group(1).strip()
            i += 1
            continue

        # Ordered list item
        ol_match = _OL_RE.match(stripped)
        if ol_match:
            flush_paragraph()
            if current_list_type != "ordered":
                close_list()
                current_list = ET.SubElement(root, "list", attrib={"type": "ordered"})
                current_list_type = "ordered"
            ET.SubElement(current_list, "item").text = ol_match.group(1).strip()
            i += 1
            continue

        # Blockquote
        if stripped.startswith(">"):
            flush_paragraph()
            close_list()
            quote_lines = []
            while i < n and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            ET.SubElement(root, "quote").text = " ".join(quote_lines)
            continue

        # Default: part of a running paragraph
        paragraph_buffer.append(stripped)
        i += 1

    flush_paragraph()

    rough = ET.tostring(root, encoding="unicode")
    pretty = minidom.parseString(rough).toprettyxml(indent="  ")
    # minidom's own declaration omits an encoding; replace it with an explicit one.
    if pretty.startswith("<?xml"):
        pretty = pretty.split("\n", 1)[1]
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{pretty}'
