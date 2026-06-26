import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.markdown_to_xml import markdown_to_xml


def test_markdown_to_xml_preserves_common_structure() -> None:
    xml = markdown_to_xml(
        "\n".join(
            [
                "# Profile",
                "",
                "Strong Python engineer.",
                "",
                "- FastAPI",
                "- Supabase",
                "",
                "| Tool | Use |",
                "| --- | --- |",
                "| Ollama | Local LLM |",
            ]
        ),
        source_filename="resume.md",
    )

    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert '<document source="resume.md">' in xml
    assert '<heading level="1">Profile</heading>' in xml
    assert "<paragraph>Strong Python engineer.</paragraph>" in xml
    assert '<list type="unordered">' in xml
    assert "<item>FastAPI</item>" in xml
    assert '<row header="true">' in xml
    assert "<cell>Ollama</cell>" in xml
