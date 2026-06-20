"""Task D: Local RAG Evaluation Pipeline.

100% local — uses qwen2.5:7b as LLM-as-a-Judge. No paid APIs.

Usage:
  python -m backend.scripts.evaluate_rag \
    --test-set backend/scripts/test_set.jsonl \
    --output   backend/scripts/eval_results.jsonl

Test set format (JSONL — one JSON object per line):
  {"question": "...", "ground_truth": "...", "context": "..."}

Metrics evaluated per sample:
  - faithfulness (1-5): Is the answer grounded in the context? (anti-hallucination)
  - answer_relevancy (1-5): Does the answer directly address the question?
  - citation_accuracy (0-1): Do cited chunk_ids exist and quotes match context?
"""
from __future__ import annotations

import argparse
import json
import logging
import statistics
import sys
from pathlib import Path
from typing import Any

import instructor
from openai import OpenAI
from pydantic import BaseModel, Field

# Allow running as `python -m backend.scripts.evaluate_rag` from repo root
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.config import get_settings
from backend.app.rag import LocalRAG

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("docmind.eval")


# ---------------------------------------------------------------------------
# Test set loading
# ---------------------------------------------------------------------------

def load_test_set(path: str) -> list[dict[str, Any]]:
    samples = []
    with open(path) as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                samples.append(json.loads(line))
            except json.JSONDecodeError as exc:
                logger.warning("Skipping malformed line %d: %s", lineno, exc)
    logger.info("Loaded %d test samples from %s", len(samples), path)
    return samples


# ---------------------------------------------------------------------------
# Judge schemas (instructor-enforced)
# ---------------------------------------------------------------------------

class FaithfulnessScore(BaseModel):
    score: int = Field(ge=1, le=5, description="1=hallucinated, 5=fully grounded in context")
    reasoning: str = Field(description="One sentence justifying the score")


class RelevancyScore(BaseModel):
    score: int = Field(ge=1, le=5, description="1=irrelevant, 5=directly addresses the question")
    reasoning: str = Field(description="One sentence justifying the score")


class EvalResult(BaseModel):
    faithfulness: FaithfulnessScore
    answer_relevancy: RelevancyScore
    citation_accuracy: float = Field(ge=0.0, le=1.0)
    raw_answer: str
    passed_citations: list[str]
    failed_citations: list[str]


# ---------------------------------------------------------------------------
# Judge prompts
# ---------------------------------------------------------------------------

FAITHFULNESS_SYSTEM = """\
You are an expert RAG evaluator. Your job is to determine whether a generated answer
is strictly supported by the provided context — this is "faithfulness."

Scoring rubric:
  5 — Every claim in the answer is explicitly stated in the context.
  4 — Nearly all claims are in context; minor paraphrase present.
  3 — Most claims are in context; one unsupported inference.
  2 — Several claims go beyond the context.
  1 — The answer contains significant hallucinations not grounded in context.

Output ONLY the JSON schema provided. No preamble.
"""

RELEVANCY_SYSTEM = """\
You are an expert RAG evaluator. Your job is to determine whether a generated answer
directly addresses the user's question — this is "answer relevancy."

Scoring rubric:
  5 — The answer directly, completely, and concisely answers the question.
  4 — The answer addresses the question but includes minor tangents.
  3 — The answer is partially relevant; misses key aspects of the question.
  2 — The answer is mostly off-topic or too generic.
  1 — The answer is entirely irrelevant to the question.

Output ONLY the JSON schema provided. No preamble.
"""


# ---------------------------------------------------------------------------
# Evaluation engine
# ---------------------------------------------------------------------------

class RagEvaluator:
    def __init__(self) -> None:
        settings = get_settings()
        raw_client = OpenAI(base_url=f"{settings.ollama_base_url}/v1", api_key="ollama")
        self.client = instructor.from_openai(raw_client, mode=instructor.Mode.JSON)
        self.model = settings.ollama_chat_model
        self.rag = LocalRAG(settings)

    def _score_faithfulness(self, question: str, answer: str, context: str) -> FaithfulnessScore:
        return self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": FAITHFULNESS_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"CONTEXT:\n{context}\n\n"
                        f"QUESTION: {question}\n\n"
                        f"GENERATED ANSWER: {answer}\n\n"
                        "Score the faithfulness of the answer to the context."
                    ),
                },
            ],
            response_model=FaithfulnessScore,
            max_retries=2,
            temperature=0.0,
        )

    def _score_relevancy(self, question: str, answer: str) -> RelevancyScore:
        return self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": RELEVANCY_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"QUESTION: {question}\n\n"
                        f"GENERATED ANSWER: {answer}\n\n"
                        "Score the relevancy of the answer to the question."
                    ),
                },
            ],
            response_model=RelevancyScore,
            max_retries=2,
            temperature=0.0,
        )

    def _check_citation_accuracy(
        self, citations: list[dict[str, str]], context: str
    ) -> tuple[float, list[str], list[str]]:
        """Check that cited chunk_ids and quotes exist in the provided context."""
        if not citations:
            return 1.0, [], []

        passed, failed = [], []
        for c in citations:
            chunk_id = c.get("chunk_id", "")
            quote = c.get("quote", "")
            # chunk_id must appear in context header; quote must be a substring of context
            id_ok = f"[chunk_id: {chunk_id}]" in context
            quote_ok = not quote or quote[:50] in context
            if id_ok and quote_ok:
                passed.append(chunk_id)
            else:
                failed.append(chunk_id)

        accuracy = len(passed) / len(citations) if citations else 1.0
        return accuracy, passed, failed

    def evaluate_sample(self, sample: dict[str, Any]) -> EvalResult:
        question: str = sample["question"]
        context: str = sample.get("context", "")

        # If context is provided in the test set, use it directly (offline eval)
        # Otherwise query the live Supabase vector store (online eval)
        if context:
            from backend.app.models import SourceChunk
            # Wrap raw context as a single synthetic SourceChunk for RAG
            fake_sources = [
                SourceChunk(
                    id="eval-chunk-0",
                    document_id="eval-doc",
                    document_name="test-context",
                    chunk_index=0,
                    content=context,
                )
            ]
            answer, citations = self.rag.answer(question, fake_sources)
        else:
            raise ValueError("Online eval requires Supabase — provide 'context' in the test set for offline eval")

        citation_accuracy, passed, failed = self._check_citation_accuracy(
            [c.model_dump() for c in citations], context
        )

        faithfulness = self._score_faithfulness(question, answer, context)
        relevancy = self._score_relevancy(question, answer)

        return EvalResult(
            faithfulness=faithfulness,
            answer_relevancy=relevancy,
            citation_accuracy=citation_accuracy,
            raw_answer=answer,
            passed_citations=passed,
            failed_citations=failed,
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="DocMind Local RAG Evaluator")
    parser.add_argument("--test-set", required=True, help="Path to JSONL test file")
    parser.add_argument("--output", default="eval_results.jsonl", help="Output JSONL path")
    args = parser.parse_args()

    samples = load_test_set(args.test_set)
    if not samples:
        logger.error("No samples found — aborting.")
        sys.exit(1)

    evaluator = RagEvaluator()
    results: list[dict[str, Any]] = []
    faithfulness_scores: list[float] = []
    relevancy_scores: list[float] = []
    citation_accuracies: list[float] = []

    for i, sample in enumerate(samples, 1):
        logger.info("Evaluating sample %d/%d: %s", i, len(samples), sample["question"][:60])
        try:
            result = evaluator.evaluate_sample(sample)
            row = {
                "question": sample["question"],
                "ground_truth": sample.get("ground_truth", ""),
                "answer": result.raw_answer,
                "faithfulness": result.faithfulness.score,
                "faithfulness_reason": result.faithfulness.reasoning,
                "answer_relevancy": result.answer_relevancy.score,
                "relevancy_reason": result.answer_relevancy.reasoning,
                "citation_accuracy": result.citation_accuracy,
                "passed_citations": result.passed_citations,
                "failed_citations": result.failed_citations,
            }
            results.append(row)
            faithfulness_scores.append(result.faithfulness.score)
            relevancy_scores.append(result.answer_relevancy.score)
            citation_accuracies.append(result.citation_accuracy)
        except Exception as exc:
            logger.error("Sample %d failed: %s", i, exc)
            results.append({"question": sample["question"], "error": str(exc)})

    # Write JSONL output
    with open(args.output, "w") as f:
        for row in results:
            f.write(json.dumps(row) + "\n")

    # Print summary
    if faithfulness_scores:
        print("\n" + "=" * 50)
        print("DocMind RAG Evaluation Summary")
        print("=" * 50)
        print(f"Samples evaluated:     {len(faithfulness_scores)}/{len(samples)}")
        print(f"Avg Faithfulness:      {statistics.mean(faithfulness_scores):.2f} / 5")
        print(f"Avg Answer Relevancy:  {statistics.mean(relevancy_scores):.2f} / 5")
        print(f"Avg Citation Accuracy: {statistics.mean(citation_accuracies):.1%}")
        print(f"\nFull results written to: {args.output}")
        print("=" * 50)


if __name__ == "__main__":
    main()
