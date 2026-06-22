"""LLM Gateway Pattern for decoupling Chat and Embedding providers."""

import base64
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import instructor
import requests
from openai import OpenAI

from .config import Settings

logger = logging.getLogger(__name__)

_VISION_TIMEOUT = 180
_EMBED_TIMEOUT = 120


class BaseChatProvider(ABC):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @abstractmethod
    def get_chat_client(self) -> Any:
        pass

    @abstractmethod
    def get_instructor_client(self) -> Any:
        pass

    @abstractmethod
    def vision(self, image_path: str) -> str:
        """Extract text from an image and return strictly as Markdown string."""
        pass


class BaseEmbeddingProvider(ABC):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        pass


# ---------------------------------------------------------------------------
# Chat Providers
# ---------------------------------------------------------------------------

class OllamaChatProvider(BaseChatProvider):
    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.client = OpenAI(
            base_url=f"{settings.ollama_base_url}/v1",
            api_key="ollama",
        )

    def get_chat_client(self) -> Any:
        return self.client

    def get_instructor_client(self) -> Any:
        return instructor.from_openai(self.client, mode=instructor.Mode.JSON)

    def vision(self, image_path: str) -> str:
        image_bytes = Path(image_path).read_bytes()
        b64 = base64.b64encode(image_bytes).decode()
        ext = Path(image_path).suffix.lstrip(".")
        mime_ext = "jpeg" if ext in ("jpg", "jpeg") else ext

        logger.info(
            "Vision OCR (Ollama): %s (%d KB) via %s",
            Path(image_path).name,
            len(image_bytes) // 1024,
            self.settings.ollama_vision_model,
        )

        try:
            response = self.client.chat.completions.create(
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
            return text
        except Exception as exc:
            logger.error("Vision OCR (Ollama) failed for %s: %s", image_path, exc)
            raise


class OllamaEmbeddingProvider(BaseEmbeddingProvider):
    def embed(self, text: str) -> list[float]:
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
                f"Expected 768-dim embedding from {self.settings.ollama_embed_model}, got {len(embedding)}"
            )
        return embedding


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------

def get_chat_provider(settings: Settings) -> BaseChatProvider:
    provider_name = settings.chat_provider.lower()
    if provider_name == "ollama":
        return OllamaChatProvider(settings)
    else:
        raise ValueError(f"Unknown chat_provider: {provider_name}")


def get_embedding_provider(settings: Settings) -> BaseEmbeddingProvider:
    provider_name = settings.embedding_provider.lower()
    if provider_name == "ollama":
        return OllamaEmbeddingProvider(settings)
    else:
        raise ValueError(f"Unknown embedding_provider: {provider_name}")
