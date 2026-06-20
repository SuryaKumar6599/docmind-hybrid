from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str = Field(min_length=1)
    match_count: int = Field(default=5, ge=1, le=20)


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
