from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    ollama_base_url: str = "http://localhost:11434"
    ollama_chat_model: str = "qwen2.5:7b"
    ollama_embed_model: str = "nomic-embed-text"
    cors_origins: tuple[str, ...] = ("http://localhost:3000",)

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.getenv("DOCMIND_CORS_ORIGINS", "http://localhost:3000")
        return cls(
            supabase_url=os.getenv("SUPABASE_URL", ""),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
            ollama_chat_model=os.getenv("OLLAMA_CHAT_MODEL", "qwen2.5:7b"),
            ollama_embed_model=os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
            cors_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
        )

    def require_supabase(self) -> None:
        if not self.supabase_url or not self.supabase_service_role_key:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env")


def get_settings() -> Settings:
    return Settings.from_env()
