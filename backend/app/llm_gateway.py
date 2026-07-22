"""LLM Gateway Pattern for decoupling Chat provider."""

import base64
import logging
import subprocess
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import instructor
from openai import OpenAI

from .config import Settings

logger = logging.getLogger(__name__)

_VISION_TIMEOUT = 180


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
        return instructor.from_openai(self.client, mode=instructor.Mode.JSON_SCHEMA)

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


class LlamaCppChatProvider(BaseChatProvider):
    """Chat provider backed by a llama-cpp-python OpenAI-compatible server.

    The server is launched as a subprocess on first instantiation and runs
    for the lifetime of the process. If the server is already running on the
    configured host:port, the subprocess is skipped.

    Model files must be local .gguf files set via env vars:
      LLAMACPP_CHAT_MODEL_PATH    — Qwen2.5-7B-Instruct-Q4_K_M.gguf  (Stage 1)
      LLAMACPP_PREMIUM_MODEL_PATH — Qwen2.5-32B-Instruct-Q4_K_M.gguf (Stage 2)
      LLAMACPP_VISION_MODEL_PATH  — Qwen2.5VL-7B-Instruct-Q4_K_M.gguf (vision OCR)
      LLAMACPP_VISION_MMPROJ_PATH — Qwen2.5VL-7B-mmproj.gguf (CLIP projector for vision)

    Download GGUF files from:
      https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF
      https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF
    """

    _server_proc: subprocess.Popen | None = None  # shared across all instances
    _server_lock = threading.Lock()

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self._base_url = f"http://{settings.llamacpp_host}:{settings.llamacpp_port}/v1"
        self.client = OpenAI(base_url=self._base_url, api_key="llamacpp")
        self._ensure_server_running()

    # ------------------------------------------------------------------
    # Server lifecycle
    # ------------------------------------------------------------------

    def _server_alive(self) -> bool:
        """Return True if the server is already accepting connections."""
        import socket
        try:
            with socket.create_connection(
                (self.settings.llamacpp_host, self.settings.llamacpp_port), timeout=1
            ):
                return True
        except OSError:
            return False

    def _ensure_server_running(self) -> None:
        """Start the llama-cpp-python server subprocess if not already running.

        The server is started with the chat model. Vision inference uses a
        separate in-process Llama instance (see vision()) to avoid restarting
        the server mid-request.
        """
        if self._server_alive():
            logger.info(
                "llama-cpp-python server already running at %s",
                self._base_url,
            )
            return

        if not self.settings.llamacpp_chat_model_path:
            raise RuntimeError(
                "LLAMACPP_CHAT_MODEL_PATH is not set. "
                "Provide the absolute path to a Qwen2.5-7B-Instruct .gguf file."
            )

        model_path = Path(self.settings.llamacpp_chat_model_path)
        if not model_path.exists():
            raise FileNotFoundError(
                f"llama.cpp model file not found: {model_path}. "
                "Download from https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF"
            )

        with LlamaCppChatProvider._server_lock:
            if self._server_alive():
                return  # another thread already started it

            cmd = [
                "python", "-m", "llama_cpp.server",
                "--model", str(model_path),
                "--model_alias", self.settings.llamacpp_chat_model_name,
                "--n_gpu_layers", str(self.settings.llamacpp_n_gpu_layers),
                "--n_ctx", str(self.settings.llamacpp_n_ctx),
                "--host", self.settings.llamacpp_host,
                "--port", str(self.settings.llamacpp_port),
                "--chat_format", "chatml",  # Qwen2.5 uses ChatML format
            ]
            logger.info(
                "Starting llama-cpp-python server: model=%s host=%s port=%d",
                model_path.name,
                self.settings.llamacpp_host,
                self.settings.llamacpp_port,
            )
            LlamaCppChatProvider._server_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            # Wait up to 30 s for the server to become ready
            import time
            for _ in range(30):
                time.sleep(1)
                if self._server_alive():
                    logger.info(
                        "llama-cpp-python server ready at %s (pid=%d)",
                        self._base_url,
                        LlamaCppChatProvider._server_proc.pid,
                    )
                    return
            raise RuntimeError(
                f"llama-cpp-python server did not start within 30 s. "
                f"Check that {model_path} is a valid GGUF file and that port "
                f"{self.settings.llamacpp_port} is free."
            )

    # ------------------------------------------------------------------
    # BaseChatProvider implementation
    # ------------------------------------------------------------------

    def get_chat_client(self) -> Any:
        return self.client

    def get_instructor_client(self) -> Any:
        return instructor.from_openai(self.client, mode=instructor.Mode.JSON_SCHEMA)

    def vision(self, image_path: str) -> str:
        """Vision OCR via Qwen2.5VL using llama-cpp-python in-process.

        Requires both LLAMACPP_VISION_MODEL_PATH and LLAMACPP_VISION_MMPROJ_PATH
        to be set (the main VL model gguf + CLIP mmproj gguf).
        """
        vision_path = self.settings.llamacpp_vision_model_path
        mmproj_path = self.settings.llamacpp_vision_mmproj_path

        if not vision_path or not mmproj_path:
            raise NotImplementedError(
                "Vision OCR requires LLAMACPP_VISION_MODEL_PATH and "
                "LLAMACPP_VISION_MMPROJ_PATH. "
                "Download Qwen2.5VL-7B GGUF + mmproj from "
                "https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF"
            )

        from llama_cpp import Llama
        from llama_cpp.llama_chat_format import Qwen2VLChatHandler

        image_bytes = Path(image_path).read_bytes()
        b64 = base64.b64encode(image_bytes).decode()
        ext = Path(image_path).suffix.lstrip(".")
        mime_ext = "jpeg" if ext in ("jpg", "jpeg") else ext

        logger.info(
            "Vision OCR (llama.cpp): %s (%d KB) via %s",
            Path(image_path).name,
            len(image_bytes) // 1024,
            Path(vision_path).name,
        )

        try:
            chat_handler = Qwen2VLChatHandler(clip_model_path=mmproj_path, verbose=False)
            vlm = Llama(
                model_path=vision_path,
                chat_handler=chat_handler,
                n_gpu_layers=self.settings.llamacpp_n_gpu_layers,
                n_ctx=self.settings.llamacpp_n_ctx,
                verbose=False,
            )
            response = vlm.create_chat_completion(
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
            )
            text: str = response["choices"][0]["message"]["content"] or ""
            return text
        except Exception as exc:
            logger.error("Vision OCR (llama.cpp) failed for %s: %s", image_path, exc)
            raise


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_chat_provider(settings: Settings) -> BaseChatProvider:
    provider_name = settings.chat_provider.lower()
    if provider_name == "ollama":
        return OllamaChatProvider(settings)
    elif provider_name == "llamacpp":
        return LlamaCppChatProvider(settings)
    else:
        raise ValueError(
            f"Unknown chat_provider: {provider_name!r}. Valid options: 'ollama', 'llamacpp'"
        )
