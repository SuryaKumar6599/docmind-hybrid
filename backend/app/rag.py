from __future__ import annotations

import json
import re
from typing import Any

from .models import Citation, SourceChunk
from .ollama import OllamaClient


class LocalRAG:
    def __init__(self, ollama: OllamaClient) -> None:
        self.ollama = ollama

    def answer(self, question: str, sources: list[SourceChunk]) -> tuple[str, list[Citation]]:
        context = "\n\n---\n\n".join(
            f"[chunk_id: {source.id}]\n[document_name: {source.document_name}]\n{source.content}"
            for source in sources
        )
        allowed_ids = {source.id for source in sources}
        messages = [
            {
                "role": "system",
                "content": (
                    "You are DocMind, a local private RAG assistant. Answer only from the context. "
                    "If the answer is not in the context, say you do not know. Return JSON only."
                ),
            },
            {
                "role": "user",
                "content": f"""
Return strict JSON:
{{
  "answer": "grounded answer",
  "citations": [
    {{"chunk_id": "exact chunk id", "document_name": "source document", "quote": "short supporting quote"}}
  ]
}}

CONTEXT:
{context}

QUESTION: {question}
""".strip(),
            },
        ]
        raw = self.ollama.chat_json(messages)["content"]
        parsed = _parse_json(raw)
        citations = []
        for item in parsed.get("citations", []):
            if not isinstance(item, dict):
                continue
            chunk_id = str(item.get("chunk_id", ""))
            if chunk_id in allowed_ids:
                citations.append(
                    Citation(
                        chunk_id=chunk_id,
                        document_name=str(item.get("document_name", "")),
                        quote=str(item.get("quote", ""))[:500],
                    )
                )
        return str(parsed.get("answer") or raw).strip(), citations


def _parse_json(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return {"answer": raw, "citations": []}
