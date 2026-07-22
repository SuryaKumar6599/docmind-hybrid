from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    chat_provider: str = "ollama"
    # Ollama settings
    ollama_base_url: str = "http://localhost:11434"
    ollama_chat_model: str = "qwen2.5:7b"
    ollama_vision_model: str = "qwen2.5vl:7b"
    # Heavier model reserved for Stage 2 (tailored content generation) only —
    # this is the quality-critical, creative task (first-person rewriting,
    # X-Y-Z bullets, fidelity to the source resume). Stage 1 (extraction/
    # classification) stays on the lighter model: ~17GB vs ~5GB, not worth
    # the latency/resource cost everywhere.
    ollama_premium_chat_model: str = "qwen3.6:27b"
    # llama-cpp-python settings (used when CHAT_PROVIDER=llamacpp)
    # Model paths must point to local .gguf files.
    # Qwen2.5-7B-Instruct GGUF: https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF
    # Qwen2.5VL-7B GGUF (vision): requires mmproj clip file alongside main gguf
    llamacpp_chat_model_path: str = ""         # e.g. /models/qwen2.5-7b-instruct-q4_k_m.gguf
    llamacpp_vision_model_path: str = ""       # e.g. /models/qwen2.5vl-7b-instruct-q4_k_m.gguf
    llamacpp_vision_mmproj_path: str = ""      # e.g. /models/qwen2.5vl-7b-mmproj.gguf
    llamacpp_premium_model_path: str = ""      # e.g. /models/qwen2.5-32b-instruct-q4_k_m.gguf
    llamacpp_chat_model_name: str = "qwen2.5-7b-instruct"    # logical name passed to OpenAI client
    llamacpp_premium_model_name: str = "qwen2.5-32b-instruct" # for Stage 2
    llamacpp_n_gpu_layers: int = -1            # -1 = offload all layers to GPU/Metal
    llamacpp_n_ctx: int = 8192
    llamacpp_host: str = "127.0.0.1"
    llamacpp_port: int = 8080

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
    # Upload guardrail: reject files larger than this before processing
    max_upload_size_mb: int = 25

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.getenv("DOCMIND_CORS_ORIGINS", "http://localhost:3000")
        return cls(
            supabase_url=os.getenv("SUPABASE_URL", ""),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            chat_provider=os.getenv("CHAT_PROVIDER", "ollama").lower(),
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
            ollama_chat_model=os.getenv("OLLAMA_CHAT_MODEL", "qwen2.5:7b"),
            ollama_premium_chat_model=os.getenv("OLLAMA_PREMIUM_CHAT_MODEL", "qwen3.6:27b"),
            ollama_vision_model=os.getenv("OLLAMA_VISION_MODEL", "qwen2.5vl:7b"),
            llamacpp_chat_model_path=os.getenv("LLAMACPP_CHAT_MODEL_PATH", ""),
            llamacpp_vision_model_path=os.getenv("LLAMACPP_VISION_MODEL_PATH", ""),
            llamacpp_vision_mmproj_path=os.getenv("LLAMACPP_VISION_MMPROJ_PATH", ""),
            llamacpp_premium_model_path=os.getenv("LLAMACPP_PREMIUM_MODEL_PATH", ""),
            llamacpp_chat_model_name=os.getenv("LLAMACPP_CHAT_MODEL_NAME", "qwen2.5-7b-instruct"),
            llamacpp_premium_model_name=os.getenv("LLAMACPP_PREMIUM_MODEL_NAME", "qwen2.5-32b-instruct"),
            llamacpp_n_gpu_layers=int(os.getenv("LLAMACPP_N_GPU_LAYERS", "-1")),
            llamacpp_n_ctx=int(os.getenv("LLAMACPP_N_CTX", "8192")),
            llamacpp_host=os.getenv("LLAMACPP_HOST", "127.0.0.1"),
            llamacpp_port=int(os.getenv("LLAMACPP_PORT", "8080")),
            cors_origins=tuple(o.strip().rstrip("/") for o in origins.split(",") if o.strip()),
            token_budget_total=int(os.getenv("TOKEN_BUDGET_TOTAL", "8000")),
            worker_poll_interval_seconds=int(os.getenv("WORKER_POLL_INTERVAL", "10")),
            docx_template_path=os.getenv("DOCX_TEMPLATE_PATH", ""),
            max_upload_size_mb=int(os.getenv("MAX_UPLOAD_SIZE_MB", "25")),
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

    @property
    def active_chat_model(self) -> str:
        """Provider-agnostic accessor for the Stage 1 chat model name."""
        if self.chat_provider == "llamacpp":
            return self.llamacpp_chat_model_name
        return self.ollama_chat_model

    @property
    def active_premium_chat_model(self) -> str:
        """Provider-agnostic accessor for the Stage 2 (premium) chat model name."""
        if self.chat_provider == "llamacpp":
            return self.llamacpp_premium_model_name
        return self.ollama_premium_chat_model


def get_settings() -> Settings:
    return Settings.from_env()
