"""RAG answer generation with instructor-enforced output structure.

Replaces the hand-rolled _parse_json regex fallback with strict Pydantic
validation via `instructor`. The LLM cannot return malformed JSON because
instructor uses grammar-constrained generation and auto-retries on failures.
"""
from __future__ import annotations

import logging
from typing import Any

import instructor
from openai import OpenAI
from pydantic import BaseModel, Field

from .models import Citation, SourceChunk
from .config import Settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# RAG answer schema (instructor-enforced)
# ---------------------------------------------------------------------------

class _RagAnswer(BaseModel):
    answer: str = Field(description="Grounded answer from the provided context only")
    citations: list[_RagCitation] = Field(default_factory=list)


class _RagCitation(BaseModel):
    chunk_id: str = Field(description="Exact chunk_id from the context")
    document_name: str
    quote: str = Field(description="Short verbatim supporting quote (<200 chars)", max_length=200)


_RagAnswer.model_rebuild()


# ---------------------------------------------------------------------------
# LocalRAG
# ---------------------------------------------------------------------------

class LocalRAG:
    """Retrieval-Augmented Generation using a local Ollama model.

    Uses `instructor` to enforce structured output — no regex JSON parsing.
    """

    def __init__(self, settings: Settings) -> None:
        raw_client = OpenAI(
            base_url=f"{settings.ollama_base_url}/v1",
            api_key="ollama",
        )
        self.client = instructor.from_openai(raw_client, mode=instructor.Mode.JSON)
        self.model = settings.ollama_chat_model

    def answer(
        self, question: str, sources: list[SourceChunk]
    ) -> tuple[str, list[Citation]]:
        context = "\n\n---\n\n".join(
            f"[chunk_id: {s.id}]\n[document_name: {s.document_name}]\n{s.content}"
            for s in sources
        )
        allowed_ids = {s.id for s in sources}

        messages: list[dict[str, str]] = [
            {
                "role": "system",
                "content": (
                    "You are DocMind, a local private RAG assistant. "
                    "Answer ONLY from the provided context. "
                    "If the answer is not in the context, set answer to 'I do not know.' "
                    "and leave citations empty."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"CONTEXT:\n{context}\n\n"
                    f"QUESTION: {question}\n\n"
                    "Respond with a grounded answer and cite the exact chunk_ids you used."
                ),
            },
        ]

        try:
            result: _RagAnswer = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_model=_RagAnswer,
                max_retries=3,
                temperature=0.0,
            )
        except Exception as exc:
            logger.error("instructor/Ollama call failed: %s", exc)
            return str(exc), []

        citations: list[Citation] = []
        for item in result.citations:
            if item.chunk_id in allowed_ids:
                citations.append(
                    Citation(
                        chunk_id=item.chunk_id,
                        document_name=item.document_name,
                        quote=item.quote[:500],
                    )
                )
            else:
                logger.warning(
                    "LLM hallucinated chunk_id %r — dropping citation", item.chunk_id
                )

        return result.answer.strip(), citations
