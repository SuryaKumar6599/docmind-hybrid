from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str = Field(min_length=1)
    match_count: int = Field(default=5, ge=1, le=20)
    category: str | None = None  # filter by document category


class Citation(BaseModel):
    chunk_id: str
    document_name: str
    quote: str = ""


class SourceChunk(BaseModel):
    id: str
    document_id: str
    document_name: str
    chunk_index: int
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    similarity: float | None = None


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    sources: list[SourceChunk] = Field(default_factory=list)


class IndexResponse(BaseModel):
    document_id: str
    document_name: str
    chunks: int


class HealthResponse(BaseModel):
    status: str
    runtime: str


class OllamaHealth(BaseModel):
    reachable: bool
    models: dict[str, bool] = Field(default_factory=dict)  # chat / vision / embed


class SupabaseHealth(BaseModel):
    configured: bool
    reachable: bool


class TunnelHealth(BaseModel):
    known: bool
    url: str | None = None


class HealthFullResponse(BaseModel):
    status: str  # "ok" | "degraded" | "down"
    runtime: str
    checked_at: str
    fastapi: bool
    ollama: OllamaHealth
    supabase: SupabaseHealth
    tunnel: TunnelHealth
