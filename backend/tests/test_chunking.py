from app.document_processing import chunk_text


def test_unstructured_text_uses_paragraph_chunking_unchanged() -> None:
    """No headings at all — must behave exactly like the original chunker."""
    text = "First paragraph here.\n\nSecond paragraph here.\n\nThird one."
    chunks = chunk_text(text, chunk_size=100)
    assert len(chunks) == 1
    assert "First paragraph" in chunks[0]
    assert "Third one" in chunks[0]


def test_heading_sections_become_separate_chunks() -> None:
    structured = "\n".join([
        "# Experience",
        "",
        "## Project A",
        "Built semantic search pipeline.",
        "Integrated vector search.",
        "",
        "## Project B",
        "Hybrid retrieval system.",
        "Citation generation.",
    ])
    chunks = chunk_text(structured, chunk_size=200)

    project_a_chunk = next(c for c in chunks if "Project A" in c)
    project_b_chunk = next(c for c in chunks if "Project B" in c)
    assert "Project B" not in project_a_chunk
    assert "Project A" not in project_b_chunk
    assert "semantic search" in project_a_chunk
    assert "Hybrid retrieval" in project_b_chunk


def test_bare_heading_with_no_body_is_not_emitted_as_its_own_chunk() -> None:
    """'# Experience' immediately followed by another heading, with nothing
    in between, shouldn't produce a near-empty standalone chunk."""
    structured = "# Experience\n## Project A\nSome real content here."
    chunks = chunk_text(structured, chunk_size=200)
    assert not any(c.strip() == "# Experience" for c in chunks)


def test_oversized_section_is_subchunked_with_heading_repeated() -> None:
    big_body = ("This is a long sentence about the project. " * 30).strip()
    oversized = f"## Big Project\n{big_body}"
    chunks = chunk_text(oversized, chunk_size=200)

    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.startswith("## Big Project")


def test_empty_input_returns_no_chunks() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n  \n") == []
