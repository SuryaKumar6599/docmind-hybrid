from app.cleaner import clean_pdf_text


def test_normalizes_ligature_glyphs() -> None:
    """The exact artifact observed in a real pasted document this session:
    PDF extraction left ligature glyphs (ﬁ/ﬂ/ﬃ) undecoded instead of
    normalizing them to plain ASCII."""
    text = "Missing ﬁelds across modules and Poor user ﬂow. Insuﬃcient eﬃciency."
    cleaned = clean_pdf_text(text)
    assert cleaned == "Missing fields across modules and Poor user flow. Insufficient efficiency."


def test_normalizes_all_four_ligature_variants() -> None:
    assert clean_pdf_text("ﬀ ﬁ ﬂ ﬃ") == "ff fi fl ffi"
