"""Supabase vector store — document indexing and semantic search.

Wraps the Supabase client with:
  - create_document: insert a document record with category tagging
  - insert_chunks: bulk-insert embeddings for RAG retrieval
  - match_documents: semantic search with optional category filter
    (uses match_documents_filtered RPC when category is given,
     falls back to match_documents if the filtered RPC is unavailable)
"""
from __future__ import annotations

import logging
from typing import Any

from supabase import Client, create_client

from .config import Settings
from .models import SourceChunk

logger = logging.getLogger(__name__)


class SupabaseVectorStore:
    def __init__(self, settings: Settings) -> None:
        settings.require_supabase()
        self.client: Client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    def create_document(
        self,
        name: str,
        metadata: dict[str, Any],
        category: str = "general",
    ) -> str:
        """Insert a document record and return its UUID."""
        result = (
            self.client.table("documents")
            .insert({"name": name, "metadata": metadata, "category": category})
            .execute()
        )
        doc_id: str = result.data[0]["id"]
        logger.info("Created document %s (category=%s, id=%s)", name, category, doc_id)
        return doc_id

    def insert_chunks(
        self,
        document_id: str,
        chunks: list[str],
        embeddings: list[list[float]],
        metadata: dict[str, Any],
    ) -> None:
        """Bulk-insert chunk rows with their embeddings."""
        if not chunks:
            logger.warning("insert_chunks called with empty chunk list for doc %s", document_id)
            return

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
        self.client.table("document_chunks").insert(rows).execute()
        logger.info("Inserted %d chunks for document %s", len(chunks), document_id)

    def match_documents(
        self,
        query_embedding: list[float],
        match_count: int,
        category: str | None = None,
    ) -> list[SourceChunk]:
        """Semantic search against stored embeddings.

        Passes category='resume' or category='general' etc. to filter.
        Falls back to the unfiltered RPC if the filtered one is missing.
        """
        params: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": match_count,
        }

        if category:
            params["filter_category"] = category
            rpc_name = "match_documents_filtered"
            logger.debug("Semantic search via %s (category=%s, k=%d)", rpc_name, category, match_count)
            try:
                result = self.client.rpc(rpc_name, params).execute()
            except Exception as exc:
                logger.warning(
                    "RPC %s failed (%s) — falling back to match_documents (no category filter)",
                    rpc_name, exc,
                )
                params.pop("filter_category", None)
                result = self.client.rpc("match_documents", params).execute()
        else:
            rpc_name = "match_documents"
            logger.debug("Semantic search via %s (k=%d)", rpc_name, match_count)
            result = self.client.rpc(rpc_name, params).execute()

        chunks = [
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
        logger.info("Search returned %d chunks", len(chunks))
        return chunks
