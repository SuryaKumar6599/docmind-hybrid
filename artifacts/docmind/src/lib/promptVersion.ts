/**
 * Bump this whenever the backend's /extract-skills or /generate-tailored
 * prompts change in a way that would make previously cached results stale
 * or wrong. Cached entries are keyed on this value, so bumping it
 * effectively invalidates every existing cache entry at once.
 */
export const PROMPT_VERSION = "v1";

/** SHA-256 hex digest via the Web Crypto API (no extra dependency). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cache key for a resume+JD(+company/role) analysis pair. Replaces the old
 * `ai_cache_${resumeId}_${company}_${role}_${jdText.length}` key, which
 * collided whenever two different JDs happened to have the same length.
 * company/role are kept in the key (unlike a strict resumeId+jdContent
 * hash) because /generate-tailored takes them as real inputs — dropping
 * them would let two different roles share a stale tailored-resume cache
 * entry for the same resume+JD pair. */
export async function analysisCacheKey(resumeId: string, jdContent: string, company: string, role: string): Promise<string> {
  return `ai_cache_${await sha256Hex(`${resumeId}:${jdContent}:${company.trim().toLowerCase()}:${role.trim().toLowerCase()}:${PROMPT_VERSION}`)}`;
}
