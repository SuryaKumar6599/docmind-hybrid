from fastapi.testclient import TestClient

from app.api import get_ollama, get_store
from app.main import app
from app.models import SourceChunk


class FakeOllama:
    def embedding(self, text: str) -> list[float]:
        return [0.01] * 768

    def chat_json(self, messages):  # type: ignore[no-untyped-def]
        return {"content": '{"answer":"Found locally.","citations":[]}'}


class FakeStore:
    def match_documents(self, query_embedding, match_count):  # type: ignore[no-untyped-def]
        return [
            SourceChunk(
                id="chunk-1",
                document_id="doc-1",
                document_name="doc.pdf",
                chunk_index=0,
                content="Local context",
                similarity=0.99,
            )
        ]


def test_health() -> None:
    client = TestClient(app)
    assert client.get("/health").json()["status"] == "ok"


def test_ask_with_dependency_overrides() -> None:
    app.dependency_overrides[get_ollama] = lambda: FakeOllama()
    app.dependency_overrides[get_store] = lambda: FakeStore()
    client = TestClient(app)

    response = client.post("/ask", json={"question": "What?", "match_count": 1})

    assert response.status_code == 200
    assert response.json()["answer"] == "Found locally."
    app.dependency_overrides.clear()
