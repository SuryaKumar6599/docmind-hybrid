from __future__ import annotations

from typing import Any

import requests
from openai import OpenAI

from .config import Settings


class OllamaClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.chat_client = OpenAI(base_url=f"{settings.ollama_base_url}/v1", api_key="ollama")

    def embedding(self, text: str) -> list[float]:
        response = requests.post(
            f"{self.settings.ollama_base_url}/api/embeddings",
            json={"model": self.settings.ollama_embed_model, "prompt": text},
            timeout=120,
        )
        response.raise_for_status()
        embedding = response.json()["embedding"]
        if len(embedding) != 768:
            raise RuntimeError(f"Expected 768-dim embedding from nomic-embed-text, got {len(embedding)}")
        return embedding

    def chat_json(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        response = self.chat_client.chat.completions.create(
            model=self.settings.ollama_chat_model,
            messages=messages,
            temperature=0.0,
        )
        content = response.choices[0].message.content or "{}"
        return {"content": content}
