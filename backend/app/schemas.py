"""Pydantic schemas for guardrailed LLM outputs.

All schemas are used with `instructor` to enforce strict JSON conformance.
The LLM literally cannot return text outside these shapes — instructor
retries automatically on validation failure.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Stage 1: Analytical — JD ↔ Resume gap analysis
# ---------------------------------------------------------------------------

class ProjectRecommendation(BaseModel):
    """A specific project from the resume recommended for this JD."""

    project_name: str = Field(description="Exact project title from the resume")
    relevance_reason: str = Field(
        description="One sentence explaining why this project aligns with the JD"
    )
    suggested_highlight: str = Field(
        description="The single bullet point from this project to emphasize"
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
        description="Up to 3 portfolio projects that best demonstrate fit for this role",
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


class TailoredContent(BaseModel):
    """Stage 2 output: rewritten resume sections ready for DOCX injection."""

    tailored_summary: str = Field(
        description=(
            "Rewritten 3–4 sentence professional summary. "
            "Opens with the one_line_pitch from Stage 1. "
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
