from app.api import _reconcile_keyword_contradictions
from app.schemas import JobMatchAnalysis


def _analysis(missing: list[str], matched: list[str]) -> JobMatchAnalysis:
    return JobMatchAnalysis(
        missing_keywords=missing,
        matched_skills=matched,
        match_score=60,
        recommended_projects=[],
        core_highlights=["Strong background"],
        one_line_pitch="Experienced engineer with relevant background",
    )


def test_moves_keyword_found_in_resume_from_missing_to_matched() -> None:
    """The exact bug report: 'Azure AI Search' flagged missing while it's
    literally in the resume."""
    resume = "Built semantic search using Azure AI Search and vector embeddings."
    analysis = _analysis(missing=["Azure AI Search", "Kubernetes"], matched=["Python"])

    fixed = _reconcile_keyword_contradictions(analysis, resume)

    assert "Azure AI Search" not in fixed.missing_keywords
    assert "Azure AI Search" in fixed.matched_skills
    assert "Kubernetes" in fixed.missing_keywords  # genuinely absent — stays missing


def test_case_and_whitespace_insensitive() -> None:
    resume = "Experience with   GraphQL   APIs at scale."
    analysis = _analysis(missing=["graphql apis"], matched=[])

    fixed = _reconcile_keyword_contradictions(analysis, resume)

    assert fixed.missing_keywords == []
    assert "graphql apis" in fixed.matched_skills


def test_does_not_duplicate_if_already_matched() -> None:
    resume = "Skilled in Python and Docker."
    analysis = _analysis(missing=["Python"], matched=["Python"])

    fixed = _reconcile_keyword_contradictions(analysis, resume)

    assert fixed.matched_skills.count("Python") == 1


def test_genuinely_missing_keywords_are_untouched() -> None:
    resume = "Skilled in Python and Docker."
    analysis = _analysis(missing=["Kubernetes", "GraphQL"], matched=["Python"])

    fixed = _reconcile_keyword_contradictions(analysis, resume)

    assert set(fixed.missing_keywords) == {"Kubernetes", "GraphQL"}


def test_empty_missing_keywords_list_is_a_noop() -> None:
    resume = "Some resume text."
    analysis = _analysis(missing=[], matched=["Python"])

    fixed = _reconcile_keyword_contradictions(analysis, resume)

    assert fixed.missing_keywords == []
    assert fixed.matched_skills == ["Python"]
