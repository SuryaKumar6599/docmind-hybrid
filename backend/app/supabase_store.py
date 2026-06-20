from __future__ import annotations

from typing import Any

from supabase import Client, create_client

from .config import Settings
from .models import SourceChunk


class SupabaseVectorStore:
    def __init__(self, settings: Settings) -> None:
        settings.require_supabase()
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    def create_document(self, name: str, metadata: dict[str, Any]) -> str:
        result = self.client.table("documents").insert({"name": name, "metadata": metadata}).execute()
        return result.data[0]["id"]

    def insert_chunks(self, document_id: str, chunks: list[str], embeddings: list[list[float]], metadata: dict[str, Any]) -> None:
        rows = [
            {
                "document_id": document_id,
                "chunk_index": index,
                "content": chunk,
                "embedding": embeddings[index],
                "metadata": metadata,
            }
            for index, chunk in enumerate(chunks)
        ]
        if rows:
            self.client.table("document_chunks").insert(rows).execute()

    def match_documents(self, query_embedding: list[float], match_count: int) -> list[SourceChunk]:
        result = self.client.rpc(
            "match_documents",
            {"query_embedding": query_embedding, "match_count": match_count},
        ).execute()
        return [
            SourceChunk(
                id=str(item["id"]),
                document_id=str(item["document_id"]),
                document_name=str(item.get("document_name") or item["document_id"]),
                chunk_index=int(item.get("chunk_index") or 0),
                content=str(item["content"]),
                metadata=item.get("metadata") or {},
                similarity=item.get("similarity"),
            )
            for item in result.data
        ]
