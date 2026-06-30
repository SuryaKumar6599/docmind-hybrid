"""Pydantic schemas for guardrailed LLM outputs.

All schemas are used with `instructor` to enforce strict JSON conformance.
The LLM literally cannot return text outside these shapes — instructor
retries automatically on validation failure.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Stage 1: Analytical — JD ↔ Resume gap analysis
# ---------------------------------------------------------------------------

class ProjectRecommendation(BaseModel):
    """An AI-suggested new project idea that would demonstrably fill skill gaps."""

    project_title: str = Field(
        description=(
            "A specific, buildable project title (e.g. 'Build a Redis-backed distributed rate limiter'). "
            "Must be concrete enough to start in under two weeks."
        )
    )
    skills_targeted: list[str] = Field(
        description=(
            "The subset of missing_keywords this project directly addresses. "
            "Must reference exact strings from missing_keywords."
        ),
        min_length=1,
        max_length=5,
    )
    one_line_description: str = Field(
        description=(
            "One sentence: what the project demonstrates and why it closes the gap "
            "(e.g. 'Demonstrates production-grade MLOps by containerising a model-serving API with CI/CD')."
        )
    )
    suggested_tech_stack: list[str] = Field(
        description=(
            "Concrete technologies to use (e.g. ['Python', 'FastAPI', 'Redis', 'Docker']). "
            "Must include at least one technology from missing_keywords."
        ),
        min_length=1,
        max_length=6,
    )


class JobMatchAnalysis(BaseModel):
    """Stage 1 output: gap analysis between resume and job description.

    Highest-priority fields appear first (Lost-in-the-Middle mitigation —
    the LLM writes missing_keywords first so they anchor the response).
    """

    missing_keywords: list[str] = Field(
        description=(
            "Keywords/technologies required by the JD that are ABSENT from the resume. "
            "List in descending order of importance."
        ),
        min_length=0,
        max_length=20,
    )
    matched_skills: list[str] = Field(
        description="Skills explicitly present in both the JD and the resume",
        min_length=0,
    )
    match_score: int = Field(
        description="Overall alignment score 0–100 (100 = perfect match)",
        ge=0,
        le=100,
    )
    recommended_projects: list[ProjectRecommendation] = Field(
        description=(
            "2–3 specific, buildable project ideas the candidate should create to fill the most "
            "critical missing_keywords. These are hypothetical new projects — not existing portfolio "
            "items. Each must target real skills from missing_keywords and be achievable in 1–2 weeks."
        ),
        max_length=3,
    )
    core_highlights: list[str] = Field(
        description=(
            "The candidate's 3–5 strongest selling points for THIS specific role. "
            "These go at the bottom of the prompt (LitM mitigation)."
        ),
        min_length=1,
        max_length=5,
    )
    one_line_pitch: str = Field(
        description=(
            "A concise 15-word pitch tying the candidate's strongest match to the role"
        )
    )


# ---------------------------------------------------------------------------
# Stage 2: Creative — rewritten resume content
# ---------------------------------------------------------------------------

class RewrittenBullet(BaseModel):
    """A single rewritten experience bullet point."""

    original: str = Field(description="The original bullet text (verbatim)")
    rewritten: str = Field(
        description=(
            "The rewritten bullet emphasizing keywords from the JD. "
            "Start with an action verb. Include a quantified result when possible."
        )
    )
    priority: int = Field(
        description="Display order (1 = show first)", ge=1
    )


class ManualReviewItem(BaseModel):
    """A JD-required skill with NO evidence anywhere in the resume — not even
    adjacent experience. Drafted separately from rewritten_bullets so nothing
    fabricated ever lands in the tailored resume without the candidate
    explicitly choosing to keep it (unlike skills_to_add, which the candidate
    can honestly claim today)."""

    skill: str = Field(description="The missing skill or requirement from the JD")
    draft_bullet: str = Field(
        description=(
            "A tentative bullet point ONLY usable if the candidate actually has this "
            "experience. Phrased so it reads obviously as a draft for the candidate to "
            "verify, edit, or delete — never inserted into rewritten_bullets automatically."
        )
    )
    reason: str = Field(
        description="One sentence: why this skill has zero direct or adjacent evidence in the resume"
    )


class TailoredContent(BaseModel):
    """Stage 2 output: rewritten resume sections ready for DOCX injection."""

    tailored_summary: str = Field(
        description=(
            "Rewritten 3–4 sentence professional summary, written in FIRST PERSON "
            "as if the candidate wrote it themselves ('I led...', 'I have...', "
            "never 'They led...' or the candidate's name in third person). "
            "Opens with the one_line_pitch from Stage 1, rephrased into first person. "
            "Weaves in the top 3 missing_keywords naturally."
        )
    )
    rewritten_bullets: list[RewrittenBullet] = Field(
        description=(
            "Rewritten bullet points for the most relevant experience section. "
            "Sorted by priority ascending (1 = show first)."
        ),
        min_length=1,
    )
    skills_to_add: list[str] = Field(
        description=(
            "Skills from missing_keywords the candidate should honestly claim "
            "if they have adjacent experience (e.g. 'TypeScript' if they know JS). "
            "Do NOT fabricate skills with zero foundation."
        ),
        max_length=10,
    )
    cover_letter_opening: str = Field(
        description=(
            "A single compelling opening paragraph (3 sentences) for a cover letter. "
            "Mentions the company name and role title."
        )
    )
    manual_review_items: list[ManualReviewItem] = Field(
        default_factory=list,
        description=(
            "JD-required skills with NO evidence anywhere in the resume — not even "
            "adjacent experience. Empty list if every JD requirement has at least "
            "adjacent evidence (those go in skills_to_add instead)."
        ),
        max_length=6,
    )
