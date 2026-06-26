function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function markdownToXml(markdown: string, source = "document"): string {
  const lines = markdown.split(/\r?\n/);
  const parts: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`, `<document source="${escapeXml(source)}">`];
  let paragraph: string[] = [];
  let listType: "ordered" | "unordered" | null = null;

  function flushParagraph() {
    const text = paragraph.join(" ").trim();
    if (text) parts.push(`  <paragraph>${escapeXml(text)}</paragraph>`);
    paragraph = [];
  }

  function closeList() {
    if (listType) parts.push("  </list>");
    listType = null;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      parts.push(`  <heading level="${heading[1].length}">${escapeXml(heading[2].trim())}</heading>`);
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "unordered" : "ordered";
      if (listType !== nextType) {
        closeList();
        parts.push(`  <list type="${nextType}">`);
        listType = nextType;
      }
      parts.push(`    <item>${escapeXml((unordered?.[1] ?? ordered?.[1] ?? "").trim())}</item>`);
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  parts.push("</document>");
  return parts.join("\n");
}
