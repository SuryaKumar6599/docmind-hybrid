"""Prompt templates for the multi-stage resume tailoring pipeline.

"Lost in the Middle" mitigation strategy (Shi et al., 2023):
- HIGHEST priority content (missing keywords, must-have requirements) → TOP of user message
- LOWEST priority filler → middle
- SECOND-HIGHEST priority content (candidate highlights) → BOTTOM of user message

Both Stage 1 and Stage 2 follow this layout.
"""
from __future__ import annotations

from .schemas import JobMatchAnalysis, TailoredContent

# ---------------------------------------------------------------------------
# Stage 1: Analytical
# ---------------------------------------------------------------------------

STAGE1_SYSTEM = """\
You are a Principal Technical Recruiter and Career Strategist with 15 years of experience at FAANG companies.

Your task: Perform a rigorous gap analysis between a candidate's resume and a job description.

Rules:
1. Be brutally honest. If a required skill is absent, list it as missing.
2. Only claim a skill as "matched" if it is explicitly mentioned in both documents.
3. Recommended projects must come ONLY from the resume text provided — do not hallucinate projects.
4. The match_score must be defensible: 80+ means truly qualified, 50–79 means strong candidate with gaps, <50 means significant mismatch.
5. Output ONLY the JSON object conforming to the schema. No preamble, no markdown fences.
"""


def build_stage1_user_message(
    compressed_jd: str,
    compressed_resume: str,
    company: str,
    role: str,
) -> str:
    """Construct the Stage 1 user message with Lost-in-the-Middle layout.

    Layout:
    [TOP]    — JD requirements (highest priority — must extract these)
    [MIDDLE] — Resume body (lower-priority bulk)
    [BOTTOM] — Explicit instruction to surface candidate highlights last
    """
    return f"""\
## PRIORITY: Job Requirements for {role} at {company}
Analyze these requirements FIRST. Every bullet below is a signal for missing_keywords or matched_skills:

{compressed_jd}

---

## Candidate Resume
{compressed_resume}

---

## FINAL INSTRUCTION (highest attention zone):
After reading the full resume, identify the candidate's 3–5 strongest selling points \
specifically for the {role} role. List these as core_highlights — they must directly \
counter the JD's most important requirements.

Produce the JSON analysis now.
"""


# ---------------------------------------------------------------------------
# Stage 2: Creative
# ---------------------------------------------------------------------------

STAGE2_SYSTEM = """\
You are a world-class resume writer who has helped candidates land roles at top-tier companies.

Your task: Rewrite specific resume sections to maximize alignment with a job description.

Rules:
1. Every rewritten bullet must start with a strong action verb (Led, Architected, Reduced, etc.).
2. Quantify results wherever the original bullet contains numbers — preserve them exactly.
3. Weave in missing_keywords naturally — never keyword-stuff awkwardly.
4. The tailored_summary must open with the one_line_pitch provided, then expand naturally.
5. Do NOT invent experience, projects, or metrics not present in the original resume.
6. Output ONLY the JSON object conforming to the schema. No preamble, no markdown fences.
"""


def build_stage2_user_message(
    original_summary: str,
    experience_bullets: list[str],
    analysis: JobMatchAnalysis,
    company: str,
    role: str,
) -> str:
    """Construct the Stage 2 user message with Lost-in-the-Middle layout.

    Layout:
    [TOP]    — Missing keywords to inject (highest priority)
    [MIDDLE] — Original resume text (bulk)
    [BOTTOM] — Core highlights from Stage 1 (anchor the rewrite)
    """
    missing = ", ".join(analysis.missing_keywords[:10]) or "none identified"
    highlights = "\n".join(f"- {h}" for h in analysis.core_highlights)
    bullets_block = "\n".join(f"- {b}" for b in experience_bullets)

    return f"""\
## PRIORITY: Missing Keywords to Inject for {role} at {company}
The following keywords are REQUIRED by the JD but absent from the resume. \
Weave them into rewrites naturally:

{missing}

---

## Original Resume Content to Rewrite

### Professional Summary:
{original_summary}

### Experience Bullets:
{bullets_block}

---

## Stage 1 Context:
- Match Score: {analysis.match_score}/100
- One-Line Pitch: {analysis.one_line_pitch}
- Recommended Projects: {", ".join(p.project_name for p in analysis.recommended_projects)}

---

## FINAL INSTRUCTION (highest attention zone):
Anchor your rewrites around these core candidate highlights — they are the \
strongest arguments for hiring this candidate for {role}:

{highlights}

Produce the JSON rewrite now.
"""
