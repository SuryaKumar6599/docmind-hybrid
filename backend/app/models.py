from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    runtime: str


class OllamaHealth(BaseModel):
    reachable: bool
    models: dict[str, bool] = Field(default_factory=dict)  # chat / vision / premium_chat


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
