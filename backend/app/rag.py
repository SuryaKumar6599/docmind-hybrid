"""RAG answer generation with instructor-enforced output structure.

Uses `instructor` to enforce strict Pydantic schema on LLM output — the
model cannot return malformed JSON because instructor uses grammar-constrained
generation and auto-retries on validation failures.

GUARDRAILS (hard constraints):
  - answer must be grounded in retrieved context only
  - citations must reference exact chunk_ids from the retrieved sources
  - hallucinated chunk_ids are stripped before the response is returned
  - LLM cannot delete, modify, or add data autonomously
"""
from __future__ import annotations

import logging
from typing import Any

import instructor
from pydantic import BaseModel, Field

from .config import Settings
from .llm_gateway import BaseChatProvider
from .models import Citation, SourceChunk

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Strict RAG output schema (instructor-enforced)
# ---------------------------------------------------------------------------

class _RagCitation(BaseModel):
    chunk_id: str = Field(description="Exact chunk_id from the provided context — do not invent IDs")
    document_name: str = Field(description="Exact document_name from the context")
    quote: str = Field(
        description="Short verbatim supporting quote (<200 chars) from that chunk",
        max_length=200,
    )


class _RagAnswer(BaseModel):
    answer: str = Field(
        description=(
            "Grounded answer derived ONLY from the provided context. "
            "If the answer is not in the context, set this to 'I do not know.'"
        )
    )
    citations: list[_RagCitation] = Field(
        default_factory=list,
        description="Citations referencing the chunk_ids used to compose the answer",
    )


# Forward-reference resolution required by instructor
_RagAnswer.model_rebuild()


# ---------------------------------------------------------------------------
# LocalRAG
# ---------------------------------------------------------------------------

class LocalRAG:
    """Retrieval-Augmented Generation using a local Ollama model.

    Structural guardrails:
      1. instructor enforces strict JSON schema — no free-form text escapes
      2. chunk_id validation strips hallucinated citations server-side
      3. System prompt explicitly forbids data mutation and hallucination
    """

    SYSTEM_PROMPT = (
        "You are DocMind, a strict and deterministic local private RAG assistant.\n"
        "CRITICAL GUARDRAILS — you MUST follow all of these:\n"
        "1. Answer ONLY from the provided CONTEXT below.\n"
        "2. Do NOT delete, modify, or add data autonomously.\n"
        "3. Do NOT invent, hallucinate, or extrapolate any information "
        "that is not explicitly present in the context.\n"
        "4. Do NOT fabricate chunk_ids — only cite IDs that appear verbatim "
        "in the context block.\n"
        "5. If the answer is not in the context, set answer to 'I do not know.' "
        "and leave citations as an empty list."
    )

    def __init__(self, settings: Settings, chat_provider: BaseChatProvider) -> None:
        self.raw_client = chat_provider.get_chat_client()
        self.client = chat_provider.get_instructor_client()
        self.model = settings.groq_chat_model if settings.chat_provider == "groq" else settings.ollama_chat_model
        logger.info("LocalRAG initialised (model=%s)", self.model)

    def answer(
        self, question: str, sources: list[SourceChunk]
    ) -> tuple[str, list[Citation]]:
        """Generate a grounded answer with validated citations.

        Returns:
            (answer_text, validated_citations)
            Hallucinated chunk_ids are silently dropped.
        """
        if not sources:
            logger.warning("answer() called with no source chunks — returning 'I do not know.'")
            return "I do not know.", []

        # Build context block
        context = "\n\n---\n\n".join(
            f"[chunk_id: {s.id}]\n[document_name: {s.document_name}]\n{s.content}"
            for s in sources
        )
        allowed_ids: set[str] = {s.id for s in sources}

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"CONTEXT:\n{context}\n\n"
                    f"QUESTION: {question}\n\n"
                    "Respond with a grounded answer and cite the exact chunk_ids you used. "
                    "Never cite a chunk_id that is not listed above."
                ),
            },
        ]

        logger.info(
            "RAG call: question=%r | sources=%d | model=%s",
            question[:80], len(sources), self.model,
        )

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

        # ---------------------------------------------------------------------------
        # Hard guardrail: strip hallucinated chunk_ids
        # ---------------------------------------------------------------------------
        validated: list[Citation] = []
        for item in result.citations:
            if item.chunk_id in allowed_ids:
                validated.append(
                    Citation(
                        chunk_id=item.chunk_id,
                        document_name=item.document_name,
                        quote=item.quote[:500],
                    )
                )
            else:
                logger.warning(
                    "Hallucinated chunk_id %r not in context — citation dropped", item.chunk_id
                )

        logger.info(
            "RAG answer: %d chars | %d citations (%d hallucinated dropped)",
            len(result.answer),
            len(validated),
            len(result.citations) - len(validated),
        )

        return result.answer.strip(), validated

    def answer_stream(
        self, question: str, sources: list[SourceChunk]
    ):
        """Streaming generator for RAG.
        
        Yields JSON strings:
        - `{"type": "token", "text": "..."}`
        - `{"type": "citations", "data": [...]}` at the very end
        """
        import json
        if not sources:
            logger.warning("answer_stream() called with no source chunks")
            yield json.dumps({"type": "token", "text": "I do not know."}) + "\n"
            yield json.dumps({"type": "citations", "data": []}) + "\n"
            return

        context = "\n\n---\n\n".join(
            f"[chunk_id: {s.id}]\n[document_name: {s.document_name}]\n{s.content}"
            for s in sources
        )
        allowed_ids: set[str] = {s.id for s in sources}

        messages = [
            {"role": "system", "content": self.SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"CONTEXT:\n{context}\n\n"
                    f"QUESTION: {question}\n\n"
                    "Respond with a grounded answer based ONLY on the context."
                ),
            },
        ]

        logger.info("RAG stream start: model=%s sources=%d", self.model, len(sources))
        
        # Phase 1: Stream the answer
        full_answer = ""
        try:
            stream = self.raw_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.0,
                stream=True,
            )
            for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    full_answer += content
                    yield json.dumps({"type": "token", "text": content}) + "\n"
        except Exception as exc:
            logger.error("Streaming call failed: %s", exc)
            yield json.dumps({"type": "token", "text": f"\n\nError: {exc}"}) + "\n"
            return

        # Phase 2: Extract citations using instructor
        class CitationExtraction(BaseModel):
            citations: list[_RagCitation] = Field(
                default_factory=list,
                description="Extract citations matching the chunk_ids for the generated answer",
            )

        citation_messages = [
            {"role": "system", "content": "You are a citation extraction tool."},
            {
                "role": "user",
                "content": (
                    f"CONTEXT:\n{context}\n\n"
                    f"ANSWER:\n{full_answer}\n\n"
                    "Extract citations for the ANSWER. Only cite chunk_ids that appear exactly in CONTEXT."
                ),
            },
        ]

        logger.info("RAG stream Phase 2: extracting citations")
        validated: list[dict[str, Any]] = []
        try:
            citation_result: CitationExtraction = self.client.chat.completions.create(
                model=self.model,
                messages=citation_messages,
                response_model=CitationExtraction,
                max_retries=2,
                temperature=0.0,
            )
            
            for item in citation_result.citations:
                if item.chunk_id in allowed_ids:
                    validated.append({
                        "chunk_id": item.chunk_id,
                        "document_name": item.document_name,
                        "quote": item.quote[:500],
                    })
        except Exception as exc:
            logger.error("Citation extraction failed: %s", exc)

        yield json.dumps({"type": "citations", "data": validated}) + "\n"
