from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    chat_provider: str = "ollama"  # "ollama"
    embedding_provider: str = "ollama"  # "ollama"
    # Ollama settings
    ollama_base_url: str = "http://localhost:11434"
    ollama_chat_model: str = "qwen2.5:7b"
    ollama_vision_model: str = "qwen2.5vl:7b"
    ollama_embed_model: str = "nomic-embed-text"
    
    cors_origins: tuple[str, ...] = ("http://localhost:3000",)
    # Token budget constants (8k context window)
    token_budget_system: int = 800
    token_budget_schema: int = 1200
    token_budget_jd: int = 3000
    token_budget_total: int = 8000
    # Worker polling
    worker_poll_interval_seconds: int = 10
    worker_max_retries: int = 3
    # Docx template path (optional, falls back to programmatic generation)
    docx_template_path: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.getenv("DOCMIND_CORS_ORIGINS", "http://localhost:3000")
        return cls(
            supabase_url=os.getenv("SUPABASE_URL", ""),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            chat_provider=os.getenv("CHAT_PROVIDER", "ollama").lower(),
            embedding_provider=os.getenv("EMBEDDING_PROVIDER", "ollama").lower(),
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
            ollama_chat_model=os.getenv("OLLAMA_CHAT_MODEL", "qwen2.5:7b"),
            ollama_vision_model=os.getenv("OLLAMA_VISION_MODEL", "qwen2.5vl:7b"),
            ollama_embed_model=os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            token_budget_total=int(os.getenv("TOKEN_BUDGET_TOTAL", "8000")),
            worker_poll_interval_seconds=int(os.getenv("WORKER_POLL_INTERVAL", "10")),
            docx_template_path=os.getenv("DOCX_TEMPLATE_PATH", ""),
        )

    def require_supabase(self) -> None:
        if not self.supabase_url or not self.supabase_service_role_key:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env")

    @property
    def token_budget_resume(self) -> int:
        """Remaining budget after fixed allocations."""
        return (
            self.token_budget_total
            - self.token_budget_system
            - self.token_budget_schema
            - self.token_budget_jd
        )


def get_settings() -> Settings:
    return Settings.from_env()
