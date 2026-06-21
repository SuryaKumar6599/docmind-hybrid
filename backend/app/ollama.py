"""Ollama client — embeddings and vision OCR via local Ollama server.

All calls use the Ollama OpenAI-compatible /v1 API for chat completions
and the native /api/embeddings endpoint for vector embeddings.
"""
from __future__ import annotations

import logging
from typing import Any

import requests
from openai import OpenAI

from .config import Settings

logger = logging.getLogger(__name__)

# Seconds before giving up on a single request
_EMBED_TIMEOUT = 120
_VISION_TIMEOUT = 180  # Vision OCR can be slow for dense images


class OllamaClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.chat_client = OpenAI(
            base_url=f"{settings.ollama_base_url}/v1",
            api_key="ollama",
        )

    def embedding(self, text: str) -> list[float]:
        """Generate a 768-dim nomic-embed-text embedding for *text*."""
        if not text.strip():
            raise ValueError("Cannot embed empty string")

        logger.debug("Embedding %d chars via %s", len(text), self.settings.ollama_embed_model)
        response = requests.post(
            f"{self.settings.ollama_base_url}/api/embeddings",
            json={"model": self.settings.ollama_embed_model, "prompt": text},
            timeout=_EMBED_TIMEOUT,
        )
        response.raise_for_status()

        embedding: list[float] = response.json()["embedding"]
        if len(embedding) != 768:
            raise RuntimeError(
                f"Expected 768-dim embedding from nomic-embed-text, got {len(embedding)}"
            )
        return embedding

    def vision_ocr(self, image_path: str) -> str:
        """Extract all text from *image_path* using the vision model.

        Returns the extracted text string (may be empty if the image
        contains no readable text).
        """
        import base64
        from pathlib import Path

        image_bytes = Path(image_path).read_bytes()
        b64 = base64.b64encode(image_bytes).decode()
        ext = Path(image_path).suffix.lstrip(".")
        # Normalise extension for data URI
        mime_ext = "jpeg" if ext in ("jpg", "jpeg") else ext

        logger.info(
            "Vision OCR: %s (%d KB) via %s",
            Path(image_path).name,
            len(image_bytes) // 1024,
            self.settings.ollama_vision_model,
        )

        try:
            response = self.chat_client.chat.completions.create(
                model=self.settings.ollama_vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/{mime_ext};base64,{b64}"},
                            },
                            {
                                "type": "text",
                                "text": (
                                    "Extract ALL text from this image verbatim. "
                                    "Preserve formatting with line breaks. "
                                    "Output only the extracted text — no commentary."
                                ),
                            },
                        ],
                    }
                ],
                temperature=0.0,
                timeout=_VISION_TIMEOUT,
            )
            text: str = response.choices[0].message.content or ""
            logger.info("Vision OCR returned %d chars", len(text))
            return text
        except Exception as exc:
            logger.error("Vision OCR failed for %s: %s", image_path, exc)
            raise
