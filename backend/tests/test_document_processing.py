from app.document_processing import chunk_text, clean_markdown


def test_clean_markdown_collapses_whitespace() -> None:
    assert clean_markdown("Hello    world\n\n\n\nNext") == "Hello world\n\nNext"


def test_chunk_text_preserves_content_order() -> None:
    text = "First paragraph.\n\nSecond paragraph is longer.\n\nThird paragraph."
    chunks = chunk_text(text, chunk_size=35, overlap=5)

    assert len(chunks) >= 2
    assert chunks[0].startswith("First paragraph.")
    assert "Third paragraph." in chunks[-1]


def test_chunk_text_empty_input() -> None:
    assert chunk_text("   ") == []
