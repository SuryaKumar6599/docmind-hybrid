import { useEffect, useState } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  AlertCircle,
  PlusCircle,
  Sparkles,
} from "lucide-react";
import {
  supabase,
  isSupabaseConfigured,
  type Resume,
  type Stage1Analysis,
  type Stage2Content,
  type RewrittenBullet,
} from "../lib/supabase";

const API_URL =
  (import.meta.env.VITE_DOCMIND_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Try to surface the FastAPI `detail` field, fall back to status text.
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) detail = String(errJson.detail);
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Intelligence() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>("");
  const [jdText, setJdText] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<Stage1Analysis | null>(null);
  const [tailoredContent, setTailoredContent] = useState<Stage2Content | null>(null);

  const [editedSummary, setEditedSummary] = useState("");
  const [editedBullets, setEditedBullets] = useState<RewrittenBullet[]>([]);

  useEffect(() => {
    if (isSupabaseConfigured) fetchResumes();
  }, []);

  async function fetchResumes() {
    const { data } = await supabase
      .from("resumes")
      .select("*")
      .eq("status", "ready")
      .order("created_at", { ascending: false });
    if (data) setResumes(data as Resume[]);
  }

  async function analyzeAndTailor() {
    if (!selectedResumeId || !jdText.trim()) {
      setError("Please select a resume and paste a Job Description.");
      return;
    }
    if (!company.trim() || !role.trim()) {
      setError("Please fill in Company and Role.");
      return;
    }
    if (!API_URL) {
      setError("VITE_DOCMIND_API_URL is not set — cannot reach the backend.");
      return;
    }

    const resume = resumes.find((r) => r.id === selectedResumeId);
    if (!resume?.markdown_content) {
      setError("Selected resume has no extracted content. Re-upload and wait for processing to finish.");
      return;
    }

    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setTailoredContent(null);

    try {
      // Stage 1: Gap Analysis
      const analysisData = await fetchJson<Stage1Analysis>(`${API_URL}/extract-skills`, {
        resume_text: resume.markdown_content,
        jd_text: jdText,
      });
      setAnalysis(analysisData);

      // Stage 2: Tailored Content
      const tailoredData = await fetchJson<Stage2Content>(`${API_URL}/generate-tailored`, {
        resume_text: resume.markdown_content,
        analysis: analysisData,
        company,
        role,
      });
      setTailoredContent(tailoredData);
      setEditedSummary(tailoredData.tailored_summary);
      setEditedBullets(tailoredData.rewritten_bullets);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setAnalyzing(false);
    }
  }

  function importMissingSkills() {
    if (!analysis?.missing_keywords?.length) return;
    const skillsLine = analysis.missing_keywords.join(" · ");
    setEditedSummary((prev) => `${prev}\n\nKey Skills: ${skillsLine}`);
  }

  function handleBulletChange(idx: number, newText: string) {
    setEditedBullets((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], rewritten: newText };
      return updated;
    });
  }

  async function downloadDocx() {
    if (!tailoredContent || !API_URL) return;

    const resume = resumes.find((r) => r.id === selectedResumeId);
    const candidateName = resume?.original_filename?.replace(/\.[^.]+$/, "") || "Candidate";

    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/export-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: {
            ...tailoredContent,
            tailored_summary: editedSummary,
            rewritten_bullets: editedBullets,
          },
          candidate_name: candidateName,
          company,
          role,
        }),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson?.detail) detail = String(errJson.detail);
        } catch {}
        throw new Error(detail);
      }

      const blob = await res.blob();
      const safe = company.replace(/\s+/g, "_").replace(/\//g, "-");
      triggerDownload(blob, `Tailored_Resume_${safe}.docx`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  const canAnalyze = !analyzing && !!selectedResumeId && !!jdText && !!company && !!role;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 border-b border-ink/10 pb-5">
        <div className="flex items-center gap-3">
          <BrainCircuit className="text-moss" size={28} />
          <h1 className="text-3xl font-semibold text-ink">Structured Resume Intelligence</h1>
        </div>
        <p className="mt-2 text-sm text-ink/60">
          Compare your resume against a job description, visualise skill gaps, edit content
          inline, and export a tailored DOCX in one flow.
        </p>
      </header>

      {!isSupabaseConfigured && (
        <div className="mb-6 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-ink/70">
          <strong>Supabase not configured.</strong> Set{" "}
          <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> to load your
          resumes.
        </div>
      )}

      {!API_URL && (
        <div className="mb-6 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-ink/70">
          <strong>Backend not configured.</strong> Set{" "}
          <code className="font-mono text-xs">VITE_DOCMIND_API_URL</code> to your FastAPI
          server URL.
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ── Left Column: Inputs & Gap Analysis ── */}
        <div className="space-y-6">
          {/* Input card */}
          <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-medium text-ink">1. Input Documents</h2>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-ink/80">
                Select Base Resume
              </label>
              <select
                id="resume-select"
                className="w-full rounded-md border border-ink/20 bg-white p-2 text-sm text-ink focus:border-moss focus:outline-none disabled:bg-ink/5"
                value={selectedResumeId}
                onChange={(e) => setSelectedResumeId(e.target.value)}
                disabled={!isSupabaseConfigured}
              >
                <option value="">-- Choose a processed resume --</option>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.original_filename}
                  </option>
                ))}
              </select>
              {isSupabaseConfigured && resumes.length === 0 && (
                <p className="mt-1 text-xs text-ink/40">
                  No ready resumes found. Upload one in the{" "}
                  <a href="/resumes" className="text-moss underline">
                    Resumes
                  </a>{" "}
                  tab first.
                </p>
              )}
            </div>

            <div className="mb-4 flex gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-ink/80">Company</label>
                <input
                  id="company-input"
                  type="text"
                  placeholder="e.g. Google"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="w-full rounded-md border border-ink/20 p-2 text-sm text-ink placeholder:text-ink/30 focus:border-moss focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-ink/80">Role</label>
                <input
                  id="role-input"
                  type="text"
                  placeholder="e.g. Senior Engineer"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-md border border-ink/20 p-2 text-sm text-ink placeholder:text-ink/30 focus:border-moss focus:outline-none"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-ink/80">
                Job Description
              </label>
              <textarea
                id="jd-textarea"
                className="h-40 w-full rounded-md border border-ink/20 p-3 text-sm text-ink placeholder:text-ink/30 focus:border-moss focus:outline-none"
                placeholder="Paste the full job description here…"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
              />
            </div>

            <button
              id="analyze-btn"
              onClick={analyzeAndTailor}
              disabled={!canAnalyze}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-moss py-2.5 text-sm font-semibold text-white transition hover:bg-moss/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {analyzing ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Analyzing… (this may take 30–60 s)
                </>
              ) : (
                <>
                  <BrainCircuit size={16} /> Analyze &amp; Tailor
                </>
              )}
            </button>
          </div>

          {/* Gap Analysis card */}
          {analysis && (
            <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-medium text-ink">Gap Analysis</h2>

              {/* Score */}
              <div className="mb-5 flex items-center justify-center border-b border-ink/10 pb-5">
                <div className="text-center">
                  <div
                    className={`text-5xl font-bold ${
                      analysis.match_score >= 70
                        ? "text-fern"
                        : analysis.match_score >= 45
                        ? "text-amber"
                        : "text-red-500"
                    }`}
                  >
                    {analysis.match_score}%
                  </div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-ink/40">
                    Match Score
                  </div>
                </div>
              </div>

              {/* One-line pitch */}
              {analysis.one_line_pitch && (
                <div className="mb-4 flex items-start gap-2 rounded-md bg-moss/5 px-3 py-2.5 text-sm italic text-moss">
                  <Sparkles size={14} className="mt-0.5 shrink-0" />
                  {analysis.one_line_pitch}
                </div>
              )}

              {/* Matched */}
              <div className="mb-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fern">
                  <CheckCircle2 size={14} /> Skills Matched ({analysis.matched_skills.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.matched_skills.map((s, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-fern/10 px-2.5 py-0.5 text-xs font-medium text-fern"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Missing */}
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber">
                  <AlertCircle size={14} /> Skills Missing ({analysis.missing_keywords.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.missing_keywords.map((s, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-amber/10 px-2.5 py-0.5 text-xs font-medium text-amber"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Column: Interactive Editor ── */}
        <div className="space-y-6">
          <div className="flex min-h-[420px] flex-col rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-4">
              <h2 className="flex items-center gap-2 text-lg font-medium text-ink">
                <FileText size={18} /> Interactive Editor
              </h2>
              {tailoredContent && (
                <button
                  id="export-docx-btn"
                  onClick={downloadDocx}
                  disabled={downloading}
                  className="flex items-center gap-1.5 rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-white transition hover:bg-moss/90 disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  Export DOCX
                </button>
              )}
            </div>

            {tailoredContent ? (
              <div className="flex-1 space-y-5 overflow-y-auto">
                {/* Summary editor */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-semibold text-ink">
                      Professional Summary
                    </label>
                    <button
                      id="import-skills-btn"
                      onClick={importMissingSkills}
                      disabled={!analysis?.missing_keywords?.length}
                      className="flex items-center gap-1 text-xs font-medium text-moss transition hover:text-moss/70 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <PlusCircle size={12} /> Import Missing Skills
                    </button>
                  </div>
                  <textarea
                    id="summary-editor"
                    value={editedSummary}
                    onChange={(e) => setEditedSummary(e.target.value)}
                    className="h-36 w-full rounded-md border border-ink/20 p-3 text-sm leading-relaxed text-ink focus:border-moss focus:outline-none"
                  />
                </div>

                {/* Bullets editor */}
                <div>
                  <label className="mb-2 block text-sm font-semibold text-ink">
                    Experience Bullets
                  </label>
                  <div className="space-y-2.5">
                    {editedBullets.map((bullet, idx) => (
                      <div key={idx} className="relative">
                        <span className="pointer-events-none absolute left-3 top-3 text-ink/30 select-none">
                          •
                        </span>
                        <textarea
                          id={`bullet-editor-${idx}`}
                          value={bullet.rewritten}
                          onChange={(e) => handleBulletChange(idx, e.target.value)}
                          className="w-full rounded-md border border-ink/10 bg-ink/[.03] p-3 pl-7 text-sm leading-relaxed text-ink transition focus:border-moss focus:bg-white focus:outline-none"
                          rows={2}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-center text-ink/35">
                <div>
                  <FileText className="mx-auto mb-3 opacity-30" size={36} />
                  <p className="text-sm">
                    {analyzing
                      ? "Generating tailored content…"
                      : "Run an analysis to see the AI-generated editor here."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
