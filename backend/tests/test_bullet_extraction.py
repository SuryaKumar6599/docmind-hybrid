import logging

from app.api import _extract_summary_and_bullets, _log_bullet_fidelity
from app.schemas import RewrittenBullet, TailoredContent


def test_extracts_dash_bullets() -> None:
    _, bullets = _extract_summary_and_bullets("- Built scalable microservices\n- Reduced latency by 40%")
    assert bullets == ["Built scalable microservices", "Reduced latency by 40%"]


def test_extracts_asterisk_bullets() -> None:
    _, bullets = _extract_summary_and_bullets("* Designed CI/CD pipelines")
    assert bullets == ["Designed CI/CD pipelines"]


def test_extracts_bullet_glyph_markers() -> None:
    """The original extraction only recognized '- ' and '* ' — silently
    dropping bullets that use •, ▪, ◦, ‣, or · instead, common when a
    resume PDF was extracted with different list-marker glyphs."""
    resume = "• Built scalable microservices\n▪ Led a team of 5\n‣ Owned the roadmap"
    _, bullets = _extract_summary_and_bullets(resume)
    assert bullets == ["Built scalable microservices", "Led a team of 5", "Owned the roadmap"]


def test_extracts_numbered_list_bullets() -> None:
    resume = "1. Led a team of 5 engineers\n2) Shipped three major features"
    _, bullets = _extract_summary_and_bullets(resume)
    assert bullets == ["Led a team of 5 engineers", "Shipped three major features"]


def test_extracts_mixed_marker_styles_in_one_resume() -> None:
    resume = "\n".join([
        "# Experience",
        "Senior Engineer at Acme",
        "",
        "• Built scalable microservices",
        "1. Led a team of 5 engineers",
        "- Reduced latency by 40%",
        "* Designed CI/CD pipelines",
    ])
    summary, bullets = _extract_summary_and_bullets(resume)
    assert len(bullets) == 4
    assert "Senior Engineer at Acme" in summary
    assert "Experience" not in summary  # heading line excluded


def test_caps_bullets_at_twenty() -> None:
    resume = "\n".join(f"- Bullet {i}" for i in range(30))
    _, bullets = _extract_summary_and_bullets(resume)
    assert len(bullets) == 20


def test_fidelity_check_flags_fabricated_original(caplog) -> None:
    """A rewritten bullet whose 'original' doesn't match anything actually
    extracted from the resume should produce a warning log line — this is
    the concrete log signal item 6 asked for."""
    source_bullets = ["Built scalable microservices", "Reduced latency by 40%"]
    tailored = TailoredContent(
        tailored_summary="I am a strong engineer.",
        rewritten_bullets=[
            RewrittenBullet(original="Built scalable microservices", rewritten="Architected scalable microservices", priority=1),
            RewrittenBullet(original="Completely invented bullet that never existed", rewritten="fabricated", priority=2),
        ],
        skills_to_add=[],
        cover_letter_opening="c",
        manual_review_items=[],
    )

    with caplog.at_level(logging.WARNING, logger="app.api"):
        _log_bullet_fidelity(tailored, source_bullets)

    assert "Completely invented bullet" in caplog.text
    assert "Architected scalable microservices" not in caplog.text


def test_fidelity_check_silent_when_no_source_bullets() -> None:
    """If extraction found zero bullets, there's nothing to compare against —
    must not crash or log noise."""
    tailored = TailoredContent(
        tailored_summary="s",
        rewritten_bullets=[RewrittenBullet(original="x", rewritten="y", priority=1)],
        skills_to_add=[], cover_letter_opening="c", manual_review_items=[],
    )
    _log_bullet_fidelity(tailored, [])  # must not raise
