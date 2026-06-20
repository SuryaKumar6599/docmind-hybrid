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
            raise RuntimeError(
                f"Expected 768-dim embedding from nomic-embed-text, got {len(embedding)}"
            )
        return embedding

    def vision_ocr(self, image_path: str) -> str:
        """Extract text from an image using the vision model."""
        import base64
        from pathlib import Path
        image_bytes = Path(image_path).read_bytes()
        b64 = base64.b64encode(image_bytes).decode()
        ext = Path(image_path).suffix.lstrip(".")
        response = self.chat_client.chat.completions.create(
            model=self.settings.ollama_vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/{ext};base64,{b64}"},
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
        )
        return response.choices[0].message.content or ""
