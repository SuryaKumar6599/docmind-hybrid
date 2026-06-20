"""Token-aware context budget allocator.

Treats the LLM context window as a financial budget:
  Total: 8000 tokens
  ├── System prompt:  800  (fixed)
  ├── JSON schema:   1200  (fixed)
  ├── JD:           3000  (capped — truncate beyond this)
  └── Resume:       3000  (remainder — compress with LLMLingua if over budget)

LLMLingua is invoked ONLY when a section exceeds its budget, avoiding the
latency cost on short documents.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tokenization (tiktoken, falls back to word-count estimate)
# ---------------------------------------------------------------------------
try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")

    def count_tokens(text: str) -> int:
        return len(_enc.encode(text))

except ImportError:
    logger.warning("tiktoken not installed — using word-count approximation (÷0.75)")

    def count_tokens(text: str) -> int:  # type: ignore[misc]
        return int(len(text.split()) / 0.75)


# ---------------------------------------------------------------------------
# LLMLingua compression (optional — graceful fallback to naive truncation)
# ---------------------------------------------------------------------------
try:
    from llmlingua import PromptCompressor
    _compressor = PromptCompressor(
        model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
        use_llmlingua2=True,
        device_map="cpu",
    )
    _LLMLINGUA_AVAILABLE = True
except ImportError:
    _LLMLINGUA_AVAILABLE = False
    logger.warning("llmlingua not installed — falling back to naive truncation")


def compress_text(text: str, target_tokens: int) -> str:
    """Compress *text* to approximately *target_tokens* tokens.

    Uses LLMLingua when available; otherwise truncates at a sentence boundary.
    Preserves high-entropy tokens (numbers, proper nouns, tech terms) by design
    — LLMLingua's perplexity model naturally ranks these as high-surprise.
    """
    current = count_tokens(text)
    if current <= target_tokens:
        return text

    ratio = target_tokens / current
    logger.info(
        "Compressing text: %d → ~%d tokens (ratio=%.2f, llmlingua=%s)",
        current, target_tokens, ratio, _LLMLINGUA_AVAILABLE,
    )

    if _LLMLINGUA_AVAILABLE:
        try:
            result = _compressor.compress_prompt(
                text,
                rate=ratio,
                force_tokens=["\n"],          # preserve paragraph structure
                drop_consecutive=True,
            )
            compressed = result["compressed_prompt"]
            logger.info("LLMLingua output: %d tokens", count_tokens(compressed))
            return compressed
        except Exception as exc:
            logger.warning("LLMLingua failed (%s) — falling back to truncation", exc)

    # Naive fallback: truncate at sentence boundaries
    sentences = text.replace("\n", " \n ").split(". ")
    kept: list[str] = []
    running = 0
    for sentence in sentences:
        t = count_tokens(sentence)
        if running + t > target_tokens:
            break
        kept.append(sentence)
        running += t
    return ". ".join(kept).strip()


# ---------------------------------------------------------------------------
# Budget allocator
# ---------------------------------------------------------------------------

@dataclass
class BudgetedTexts:
    jd: str
    resume: str
    jd_tokens: int
    resume_tokens: int
    was_compressed: bool


def allocate_budget(
    jd_text: str,
    resume_text: str,
    budget_jd: int = 3000,
    budget_resume: int = 3000,
) -> BudgetedTexts:
    """Fit JD and resume text within their respective token budgets.

    Returns compressed versions (in-place compression — originals unchanged).
    The caller should use .jd and .resume for LLM calls.
    """
    jd_tokens = count_tokens(jd_text)
    resume_tokens = count_tokens(resume_text)
    was_compressed = False

    if jd_tokens > budget_jd:
        jd_text = compress_text(jd_text, budget_jd)
        jd_tokens = count_tokens(jd_text)
        was_compressed = True
        logger.info("JD compressed to %d tokens", jd_tokens)

    if resume_tokens > budget_resume:
        resume_text = compress_text(resume_text, budget_resume)
        resume_tokens = count_tokens(resume_text)
        was_compressed = True
        logger.info("Resume compressed to %d tokens", resume_tokens)

    return BudgetedTexts(
        jd=jd_text,
        resume=resume_text,
        jd_tokens=jd_tokens,
        resume_tokens=resume_tokens,
        was_compressed=was_compressed,
    )
