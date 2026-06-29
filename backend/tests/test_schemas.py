from app.config import Settings
from app.schemas import ManualReviewItem, RewrittenBullet, TailoredContent


def test_tailored_content_accepts_manual_review_items() -> None:
    tc = TailoredContent(
        tailored_summary="I am a strong engineer.",
        rewritten_bullets=[RewrittenBullet(original="a", rewritten="b", priority=1)],
        skills_to_add=[],
        cover_letter_opening="c",
        manual_review_items=[
            ManualReviewItem(skill="Kubernetes", draft_bullet="[DRAFT] Deployed via Kubernetes", reason="No mention of container orchestration anywhere in resume")
        ],
    )
    assert tc.manual_review_items[0].skill == "Kubernetes"


def test_manual_review_items_defaults_to_empty_list() -> None:
    tc = TailoredContent(
        tailored_summary="s",
        rewritten_bullets=[RewrittenBullet(original="a", rewritten="b", priority=1)],
        skills_to_add=[],
        cover_letter_opening="c",
    )
    assert tc.manual_review_items == []


def test_premium_chat_model_has_a_default() -> None:
    settings = Settings(supabase_url="https://dummy.supabase.co", supabase_service_role_key="dummy")
    assert settings.ollama_premium_chat_model == "qwen3.6:27b"
