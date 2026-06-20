from __future__ import annotations

from typing import Any

from supabase import Client, create_client

from .config import Settings
from .models import SourceChunk


class SupabaseVectorStore:
    def __init__(self, settings: Settings) -> None:
        settings.require_supabase()
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    def create_document(
        self,
        name: str,
        metadata: dict[str, Any],
        category: str = "general",
    ) -> str:
        result = (
            self.client.table("documents")
            .insert({"name": name, "metadata": metadata, "category": category})
            .execute()
        )
        return result.data[0]["id"]

    def insert_chunks(
        self,
        document_id: str,
        chunks: list[str],
        embeddings: list[list[float]],
        metadata: dict[str, Any],
    ) -> None:
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

    def match_documents(
        self,
        query_embedding: list[float],
        match_count: int,
        category: str | None = None,
    ) -> list[SourceChunk]:
        """Semantic search. Pass category='resume' or category='portfolio' to filter."""
        params: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": match_count,
        }
        if category:
            params["filter_category"] = category

        rpc_name = "match_documents_filtered" if category else "match_documents"
        result = self.client.rpc(rpc_name, params).execute()

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
