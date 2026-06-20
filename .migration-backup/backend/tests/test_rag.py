from app.models import SourceChunk
from app.rag import LocalRAG


class FakeOllama:
    def chat_json(self, messages):  # type: ignore[no-untyped-def]
        return {
            "content": (
                '{"answer":"Payment is due in 30 days.",'
                '"citations":[{"chunk_id":"chunk-1","document_name":"invoice.pdf","quote":"due in 30 days"}]}'
            )
        }


def test_rag_accepts_only_known_citation_ids() -> None:
    sources = [
        SourceChunk(
            id="chunk-1",
            document_id="doc-1",
            document_name="invoice.pdf",
            chunk_index=0,
            content="Payment is due in 30 days.",
        )
    ]

    answer, citations = LocalRAG(FakeOllama()).answer("When is payment due?", sources)  # type: ignore[arg-type]

    assert answer == "Payment is due in 30 days."
    assert citations[0].chunk_id == "chunk-1"
