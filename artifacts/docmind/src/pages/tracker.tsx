import { useEffect, useCallback, useRef, useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  CopyCheck,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  PlusCircle,
  Save,
  Search,
  Sparkles,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  supabase,
  isSupabaseConfigured,
  type JobApplication,
  type ApplicationStatus,
  type Resume,
  type Stage1Analysis,
  type Stage2Content,
} from "../lib/supabase";

import { useBackendStatus, type BackendStatus } from "../lib/useBackendStatus";
import { BackendStatusDot } from "../components/BackendStatusDot";

// Removed static API_URL

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<ApplicationStatus, { label: string; color: string; bg: string }> = {
  to_apply:           { label: "To Apply",  color: "text-ink/60",  bg: "bg-ink/5" },
  pending_processing: { label: "Queued",    color: "text-amber",   bg: "bg-amber/10" },
  processing:         { label: "Processing",color: "text-signal",  bg: "bg-signal/10" },
  stage1_complete:    { label: "Analysed",  color: "text-moss",    bg: "bg-moss/10" },
  ready:              { label: "Ready",     color: "text-fern",    bg: "bg-fern/10" },
  error:              { label: "Error",     color: "text-red-500", bg: "bg-red-50" },
  applied:            { label: "Applied",   color: "text-signal",  bg: "bg-signal/10" },
  interview:          { label: "Interview", color: "text-moss",    bg: "bg-moss/10" },
  offer:              { label: "Offer!",    color: "text-fern",    bg: "bg-fern/20" },
  rejected:           { label: "Rejected",  color: "text-ink/40",  bg: "bg-ink/5" },
};
const PIPELINE_STATUSES: ApplicationStatus[] = ["pending_processing", "processing", "stage1_complete", "ready"];

function matchScoreAccent(score: number): string {
  if (score >= 75) return "text-fern border-fern/40";
  if (score >= 50) return "text-amber border-amber/40";
  return "text-red-500 border-red-300";
}

const LOADING_STAGES = ["Comparing resume and JD…", "Extracting missing keywords…", "Scoring your fit…"];

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
function exportToCSV(apps: JobApplication[]) {
  const headers = ["Company", "Role", "Status", "Date", "Match Score", "Notes"];
  const rows = apps.map((a) => [
    `"${a.company_name.replace(/"/g, '""')}"`,
    `"${a.role.replace(/"/g, '""')}"`,
    STATUS_CONFIG[a.status].label,
    a.application_date ?? "",
    a.match_score != null ? String(a.match_score) : "",
    `"${(a.notes ?? "").replace(/"/g, '""')}"`,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `docmind-applications-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function ScoreCircle({ score }: { score: number }) {
  const color = score >= 75 ? "#4caf7d" : score >= 50 ? "#f5a623" : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="22" fill="none" stroke="#e5e7eb" strokeWidth="5" />
        <circle cx="26" cy="26" r="22" fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${(score / 100) * 138.2} 138.2`} strokeLinecap="round"
          transform="rotate(-90 26 26)" />
        <text x="26" y="31" textAnchor="middle" fontSize="13" fontWeight="700" fill={color}>{score}</text>
      </svg>
      <span className="text-xs text-ink/40">/ 100</span>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-ink/40 hover:bg-ink/5 hover:text-ink transition-colors">
      {copied ? <CopyCheck size={11} className="text-fern" /> : <Copy size={11} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stage 2 panel: cover letter + bullets diff + skills to add
// ---------------------------------------------------------------------------
function Stage2Panel({ content }: { content: Stage2Content }) {
  const sorted = [...content.rewritten_bullets].sort((a, b) => a.priority - b.priority);
  return (
    <div className="space-y-4">
      {/* Cover letter opening */}
      {content.cover_letter_opening && (
        <div className="rounded-md border border-ink/10 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Cover Letter Opening</p>
            <CopyButton text={content.cover_letter_opening} label="Copy paragraph" />
          </div>
          <p className="text-sm leading-relaxed text-ink/80 italic">"{content.cover_letter_opening}"</p>
        </div>
      )}

      {/* Tailored summary */}
      {content.tailored_summary && (
        <div className="rounded-md border border-ink/10 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Tailored Summary</p>
            <CopyButton text={content.tailored_summary} label="Copy summary" />
          </div>
          <p className="text-sm leading-relaxed text-ink/80">{content.tailored_summary}</p>
        </div>
      )}

      {/* Rewritten bullets diff */}
      {sorted.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">
            Rewritten Bullets ({sorted.length})
          </p>
          <div className="space-y-2">
            {sorted.map((b, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-ink/10 bg-white p-3 text-xs">
                <div>
                  <p className="mb-1 font-medium text-ink/40">Original</p>
                  <p className="text-ink/60 leading-relaxed">{b.original}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="font-medium text-moss">Rewritten</p>
                    <CopyButton text={b.rewritten} />
                  </div>
                  <p className="text-ink leading-relaxed">{b.rewritten}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills to add */}
      {content.skills_to_add.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">
            Skills to honestly claim
          </p>
          <div className="flex flex-wrap gap-1.5">
            {content.skills_to_add.map((s) => (
              <span key={s} className="rounded-full bg-signal/10 px-2.5 py-0.5 text-xs font-medium text-signal">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Skills Check panel
// ---------------------------------------------------------------------------
function QuickSkillsPanel({
  resumes,
  existingApps,
  backendStatus,
  apiUrl: API_URL,
  onAdded,
}: {
  resumes: Resume[];
  existingApps: JobApplication[];
  backendStatus: BackendStatus;
  apiUrl: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Stage1Analysis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [trackForm, setTrackForm] = useState({
    company: "",
    role: "",
    resume_id: resumes.find((r) => r.status === "ready" && r.is_default)?.id ?? resumes.find((r) => r.status === "ready")?.id ?? "",
  });
  const [showTrack, setShowTrack] = useState(false);
  const [copiedKeywords, setCopiedKeywords] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [loadedApplicationId, setLoadedApplicationId] = useState("");

  const readyResumes = resumes.filter((r) => r.status === "ready");
  const canAnalyse = resumeText.trim().length > 0 && jdText.trim().length > 0;

  function handleLoadApplication(id: string) {
    setLoadedApplicationId(id);
    setResult(null); setErr(null); setSaved(false); setShowTrack(false);
    if (!id) { setResumeText(""); setJdText(""); return; }
    const app = existingApps.find((a) => a.id === id);
    if (!app) return;
    const resume = resumes.find((r) => r.id === app.resume_id);
    setResumeText(resume?.markdown_content ?? "");
    setJdText(app.jd_content ?? "");
    setTrackForm((f) => ({ ...f, company: app.company_name, role: app.role, resume_id: app.resume_id }));
  }

  async function analyse() {
    if (!resumeText.trim() || !jdText.trim()) {
      setErr("Paste both your resume text and the job description.");
      return;
    }
    setLoading(true); setErr(null); setResult(null); setShowTrack(false); setSaved(false); setLoadingStage(0);
    const stageTimer = setInterval(() => {
      setLoadingStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1));
    }, 1700);
    try {
      const res = await fetch(`${API_URL}/extract-skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_text: resumeText, jd_text: jdText }),
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      setResult(await res.json() as Stage1Analysis);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      clearInterval(stageTimer);
      setLoading(false);
    }
  }

  async function saveAsApplication() {
    if (!trackForm.company || !trackForm.role || !trackForm.resume_id) {
      setSaveErr("Company, role, and resume are required.");
      return;
    }
    setSaving(true); setSaveErr(null);
    try {
      if (loadedApplicationId) {
        const { error } = await supabase.from("job_applications").update({
          resume_id: trackForm.resume_id,
          status: "stage1_complete",
          match_score: result!.match_score,
          stage1_analysis: result,
          jd_content: jdText,
        }).eq("id", loadedApplicationId);
        if (error) throw new Error(error.message);
      } else {
        const dup = existingApps.find(
          (a) => a.company_name.toLowerCase() === trackForm.company.toLowerCase() &&
                 a.role.toLowerCase() === trackForm.role.toLowerCase()
        );
        if (dup && !window.confirm(`You already have an application for "${trackForm.role} @ ${trackForm.company}". Add anyway?`)) {
          setSaving(false);
          return;
        }
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from("job_applications").insert({
          user_id: user?.id ?? "anonymous",
          resume_id: trackForm.resume_id,
          company_name: trackForm.company,
          role: trackForm.role,
          status: "stage1_complete",
          match_score: result!.match_score,
          stage1_analysis: result,
          jd_content: jdText,
          application_date: new Date().toISOString().split("T")[0],
        });
        if (error) throw new Error(error.message);
      }
      setSaved(true);
      setShowTrack(false);
      onAdded();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function copyAllKeywords() {
    if (!result) return;
    navigator.clipboard.writeText(result.missing_keywords.join(", ")).then(() => {
      setCopiedKeywords(true);
      setTimeout(() => setCopiedKeywords(false), 2000);
    });
  }

  return (
    <div className="mb-6 rounded-xl border border-ink/10 bg-white/80 shadow-sm overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-ink/3 transition-colors">
        <Sparkles size={16} className="shrink-0 text-moss" />
        <span className="flex-1 text-sm font-semibold text-ink">Quick Skills Check</span>
        <span className="flex items-center gap-2 text-xs text-ink/40 mr-2">
          <BackendStatusDot status={backendStatus} apiUrl={API_URL} />
          Paste resume + JD → instant gap analysis
        </span>
        {open ? <ChevronUp size={15} className="shrink-0 text-ink/30" /> : <ChevronDown size={15} className="shrink-0 text-ink/30" />}
      </button>

      {open && (
        <div className="border-t border-ink/10 px-5 py-4 space-y-4">
          {backendStatus === "offline" && (
            <p className="rounded-md bg-amber/10 px-3 py-2 text-sm text-amber">
              {API_URL
                ? "Local backend unreachable — start FastAPI + Cloudflare Tunnel then refresh."
                : <>Set <code className="font-mono text-xs">VITE_DOCMIND_API_URL</code> to your Cloudflare tunnel URL.</>}
            </p>
          )}

          {existingApps.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-ink/40 shrink-0">Load from existing application</label>
              <select value={loadedApplicationId} onChange={(e) => handleLoadApplication(e.target.value)}
                className="flex-1 rounded-md border border-ink/15 bg-paper px-2.5 py-1.5 text-xs">
                <option value="">— New check —</option>
                {existingApps.map((a) => (
                  <option key={a.id} value={a.id}>{a.company_name} — {a.role}</option>
                ))}
              </select>
            </div>
          )}

          {loadedApplicationId && !jdText && (
            <p className="text-xs text-ink/40">No saved JD text for this application yet — paste it below, and it'll be saved on update.</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink/50">Resume (plain text)</label>
              <textarea rows={10} value={resumeText} onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste your resume text here…"
                className="w-full resize-y rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm placeholder:text-ink/25 focus:border-moss focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink/50">Job description (plain text)</label>
              <textarea rows={10} value={jdText} onChange={(e) => setJdText(e.target.value)}
                placeholder="Paste the job description here…"
                className="w-full resize-y rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm placeholder:text-ink/25 focus:border-moss focus:outline-none" />
            </div>
          </div>

          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

          <div className="flex items-center gap-3">
            <button onClick={analyse} disabled={loading || backendStatus === "offline" || !canAnalyse}
              className="flex items-center gap-2 rounded-md bg-moss px-5 py-2 text-sm font-semibold text-white disabled:bg-ink/25 hover:bg-moss/90 transition-colors">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? LOADING_STAGES[loadingStage] : "Analyse with AI"}
            </button>
            {result && !saved && (
              <button onClick={() => setShowTrack((v) => !v)}
                className="flex items-center gap-1.5 rounded-md border border-moss px-4 py-2 text-sm font-medium text-moss hover:bg-moss/5 transition-colors">
                <PlusCircle size={14} />
                {loadedApplicationId ? "Update application" : "Track this application"}
              </button>
            )}
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-fern">
                <CheckCircle2 size={14} /> {loadedApplicationId ? "Application updated!" : "Saved to tracker!"}
              </span>
            )}
            {result && (
              <button onClick={() => { setResult(null); setResumeText(""); setJdText(""); setShowTrack(false); setSaved(false); setLoadedApplicationId(""); }}
                className="ml-auto text-sm text-ink/40 hover:text-ink">Clear</button>
            )}
          </div>

          {/* Save-as-application mini form */}
          {showTrack && result && (
            <div className="rounded-lg border border-moss/30 bg-moss/5 p-4 space-y-3">
              <p className="text-sm font-semibold text-moss">
                {loadedApplicationId
                  ? `Update application — match score pre-filled (${result.match_score}%)`
                  : `Add to Tracker — match score pre-filled (${result.match_score}%)`}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/50">Company</label>
                  <input value={trackForm.company} disabled={!!loadedApplicationId}
                    onChange={(e) => setTrackForm({ ...trackForm, company: e.target.value })}
                    className="w-full rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm disabled:bg-ink/5 disabled:text-ink/50" placeholder="Acme Corp" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/50">Role</label>
                  <input value={trackForm.role} disabled={!!loadedApplicationId}
                    onChange={(e) => setTrackForm({ ...trackForm, role: e.target.value })}
                    className="w-full rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm disabled:bg-ink/5 disabled:text-ink/50" placeholder="Senior Engineer" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink/50">Base Resume</label>
                <select value={trackForm.resume_id} onChange={(e) => setTrackForm({ ...trackForm, resume_id: e.target.value })}
                  className="w-full rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm">
                  {readyResumes.map((r) => <option key={r.id} value={r.id}>{r.original_filename}</option>)}
                  {readyResumes.length === 0 && <option disabled>No ready resumes — upload one first</option>}
                </select>
              </div>
              {saveErr && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{saveErr}</p>}
              <div className="flex gap-3">
                <button onClick={saveAsApplication} disabled={saving || readyResumes.length === 0}
                  className="flex items-center gap-2 rounded-md bg-moss px-4 py-1.5 text-sm font-semibold text-white disabled:bg-ink/25">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {saving ? "Saving…" : loadedApplicationId ? "Update" : "Save"}
                </button>
                <button onClick={() => setShowTrack(false)} className="text-sm text-ink/40 hover:text-ink">Cancel</button>
              </div>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="rounded-xl border border-ink/10 bg-paper p-4 space-y-4">
              <div className="flex items-center gap-5">
                <ScoreCircle score={result.match_score} />
                <div className="flex-1 min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-ink/40">Your pitch for this role</p>
                    <CopyButton text={result.one_line_pitch} label="Copy pitch" />
                  </div>
                  <p className="text-sm italic text-ink/80 leading-relaxed">"{result.one_line_pitch}"</p>
                </div>
              </div>

              {result.missing_keywords.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">
                      Missing keywords ({result.missing_keywords.length}) — add to your resume
                    </p>
                    <button onClick={copyAllKeywords}
                      className="flex items-center gap-1 text-xs text-ink/40 hover:text-ink transition-colors">
                      {copiedKeywords ? <CopyCheck size={11} className="text-fern" /> : <Copy size={11} />}
                      {copiedKeywords ? "Copied!" : "Copy all"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.missing_keywords.map((kw) => (
                      <span key={kw} className="rounded-full bg-amber/15 px-2.5 py-0.5 text-xs font-medium text-amber">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.matched_skills.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">
                    Matched skills ({result.matched_skills.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.matched_skills.map((s) => (
                      <span key={s} className="rounded-full bg-fern/15 px-2.5 py-0.5 text-xs font-medium text-fern">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.core_highlights.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">Strongest selling points</p>
                  <ul className="space-y-1">
                    {result.core_highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-sm text-ink/70">
                        <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-fern" />{h}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Skills to add — NEW */}
              {(result as any).skills_to_add?.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">
                    Skills to honestly claim (adjacent experience)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(result as any).skills_to_add.map((s: string) => (
                      <span key={s} className="rounded-full bg-signal/10 px-2.5 py-0.5 text-xs font-medium text-signal">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.recommended_projects.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">Portfolio to highlight</p>
                  <div className="space-y-2">
                    {result.recommended_projects.map((p) => (
                      <div key={p.project_name} className="rounded-md border border-ink/10 bg-white px-3 py-2 text-sm">
                        <p className="font-medium text-ink">{p.project_name}</p>
                        <p className="text-xs text-ink/50 mt-0.5">{p.relevance_reason}</p>
                        <p className="mt-1 text-xs text-moss">→ {p.suggested_highlight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Application Modal — with duplicate detection + keyboard shortcuts
// ---------------------------------------------------------------------------
function AddAppModal({
  resumes,
  existingApps,
  onClose,
  onAdded,
}: {
  resumes: Resume[];
  existingApps: JobApplication[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    company_name: "",
    role: "",
    jd_url: "",
    resume_id: resumes.find((r) => r.status === "ready" && r.is_default)?.id ?? resumes.find((r) => r.status === "ready")?.id ?? "",
  });
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const ready = resumes.filter((r) => r.status === "ready");

  // Keyboard shortcuts: Esc = close, Ctrl/Cmd+Enter = submit
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Duplicate detection on blur
  function checkDuplicate() {
    if (!form.company_name || !form.role) return;
    const dup = existingApps.find(
      (a) => a.company_name.toLowerCase() === form.company_name.toLowerCase() &&
             a.role.toLowerCase() === form.role.toLowerCase()
    );
    setDupWarning(dup ? `You already have an application for this role.` : null);
  }

  async function submit() {
    if (!form.company_name || !form.role || !form.resume_id) {
      setErr("Company, role, and resume are required.");
      return;
    }
    setSaving(true); setErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? "anonymous";
      let jdStoragePath: string | null = null;
      if (jdFile) {
        const path = `${userId}/${Date.now()}_${jdFile.name}`;
        const { error } = await supabase.storage.from("job-descriptions").upload(path, jdFile);
        if (error) throw new Error(error.message);
        jdStoragePath = path;
      }
      const { error } = await supabase.from("job_applications").insert({
        user_id: userId,
        resume_id: form.resume_id,
        company_name: form.company_name,
        role: form.role,
        jd_url: form.jd_url || null,
        jd_storage_path: jdStoragePath,
        status: jdStoragePath ? "pending_processing" : "to_apply",
        application_date: new Date().toISOString().split("T")[0],
      });
      if (error) throw new Error(error.message);
      onAdded(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-paper shadow-xl">
        <div className="border-b border-ink/10 px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-ink">Add Job Application</h2>
          <span className="text-xs text-ink/30">Esc to cancel · ⌘↵ to save</span>
        </div>
        <div className="space-y-4 px-5 py-4">
          {ready.length === 0 && (
            <p className="rounded-md bg-amber/10 px-3 py-2 text-sm text-amber">
              Upload a resume first (Resumes tab) and wait for it to be processed.
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/60">Base Resume *</label>
            <select value={form.resume_id} onChange={(e) => setForm({ ...form, resume_id: e.target.value })}
              className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm">
              {ready.map((r) => <option key={r.id} value={r.id}>{r.original_filename}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/60">Company *</label>
              <input value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                onBlur={checkDuplicate}
                className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm" placeholder="Acme Corp" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/60">Role *</label>
              <input value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                onBlur={checkDuplicate}
                className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm" placeholder="Senior Engineer" />
            </div>
          </div>
          {dupWarning && (
            <p className="rounded-md bg-amber/10 px-3 py-2 text-sm text-amber">⚠ {dupWarning}</p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/60">JD URL (optional)</label>
            <input value={form.jd_url} onChange={(e) => setForm({ ...form, jd_url: e.target.value })}
              className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm" placeholder="https://jobs.example.com/..." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/60">
              Upload JD file (PDF/DOCX) — triggers AI tailoring
            </label>
            <input type="file" accept=".pdf,.docx,.txt"
              onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm file:mr-2 file:rounded file:border-0 file:bg-moss file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white" />
          </div>
          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-ink/10 px-5 py-3">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-ink/60 hover:text-ink">Cancel</button>
          <button onClick={submit} disabled={saving || ready.length === 0}
            className="flex items-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-semibold text-white disabled:bg-ink/25">
            {saving && <Loader2 className="animate-spin" size={14} />}
            {saving ? "Saving..." : "Add Application"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application row — with notes editing, cover letter, bullets diff
// ---------------------------------------------------------------------------
function ApplicationRow({
  app,
  onStatusChange,
  onNotesSave,
}: {
  app: JobApplication;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onNotesSave: (id: string, notes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(app.notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"analysis" | "tailored" | "notes">("analysis");
  const cfg = STATUS_CONFIG[app.status];
  const isProcessing = PIPELINE_STATUSES.includes(app.status) && app.status !== "ready";

  async function saveNotes() {
    setNotesSaving(true);
    await onNotesSave(app.id, notes);
    setNotesSaving(false);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  return (
    <li className="rounded-lg border border-ink/10 bg-white/80 shadow-sm">
      <div className="flex cursor-pointer items-center gap-4 px-4 py-3" onClick={() => setExpanded((v) => !v)}>
        <Briefcase className="shrink-0 text-ink/30" size={18} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {app.role} <span className="text-ink/50">@ {app.company_name}</span>
          </p>
          <p className="text-xs text-ink/40">
            {app.application_date ? new Date(app.application_date).toLocaleDateString() : "No date"}
            {app.match_score != null && (
              <span className={`ml-1 border-b-2 pb-px font-medium ${matchScoreAccent(app.match_score)}`}>
                · {app.match_score}% match
              </span>
            )}
          </p>
        </div>
        <div className={`flex min-w-[96px] items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.color} ${cfg.bg}`}>
          {isProcessing && <Loader2 className="animate-spin" size={11} />}
          {cfg.label}
        </div>
        {expanded ? <ChevronUp size={16} className="shrink-0 text-ink/30" /> : <ChevronDown size={16} className="shrink-0 text-ink/30" />}
      </div>

      {expanded && (
        <div className="border-t border-ink/10 px-4 py-4 space-y-4">
          {/* Status + JD link */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-ink/50">Status:</span>
            <select value={app.status} onChange={(e) => onStatusChange(app.id, e.target.value as ApplicationStatus)}
              className="rounded-md border border-ink/15 bg-paper px-2 py-1 text-sm">
              {(Object.keys(STATUS_CONFIG) as ApplicationStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
            {app.jd_url && (
              <a href={app.jd_url} target="_blank" rel="noreferrer"
                className="ml-auto flex items-center gap-1 text-xs text-signal hover:underline">
                <ExternalLink size={12} /> View JD
              </a>
            )}
          </div>

          {/* Tab bar (only if there's content) */}
          {(app.stage1_analysis || app.stage2_content || true) && (
            <div className="flex gap-1 rounded-lg border border-ink/10 bg-ink/3 p-1">
              {[
                { id: "analysis" as const, label: "AI Analysis", show: Boolean(app.stage1_analysis) },
                { id: "tailored" as const, label: "Tailored Content", show: Boolean(app.stage2_content) },
                { id: "notes" as const, label: "Notes", show: true },
              ].filter((t) => t.show).map((t) => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === t.id ? "bg-white shadow-sm text-ink" : "text-ink/50 hover:text-ink"
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Analysis tab */}
          {activeTab === "analysis" && app.stage1_analysis && (
            <div className="rounded-md border border-ink/10 bg-paper p-3 text-sm space-y-3">
              <div className="flex items-center gap-4">
                <ScoreCircle score={app.stage1_analysis.match_score} />
                <div className="flex-1 min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-moss">AI Analysis</p>
                    <p className="text-[10px] text-ink/35">
                      Last analysed {new Date(app.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <p className="text-ink/70 italic text-xs leading-relaxed">"{app.stage1_analysis.one_line_pitch}"</p>
                </div>
              </div>
              {app.stage1_analysis.missing_keywords.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs font-medium text-ink/50">Missing keywords</p>
                    <CopyButton text={app.stage1_analysis.missing_keywords.join(", ")} label="Copy all" />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {app.stage1_analysis.missing_keywords.map((kw) => (
                      <span key={kw} className="rounded-full bg-amber/15 px-2 py-0.5 text-xs text-amber">{kw}</span>
                    ))}
                  </div>
                </div>
              )}
              {app.stage1_analysis.matched_skills.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-ink/50 mb-1">Matched skills</p>
                  <div className="flex flex-wrap gap-1">
                    {app.stage1_analysis.matched_skills.map((s) => (
                      <span key={s} className="rounded-full bg-fern/15 px-2 py-0.5 text-xs text-fern">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {app.stage1_analysis.core_highlights.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-ink/50 mb-1">Strengths for this role</p>
                  <ul className="space-y-0.5">
                    {app.stage1_analysis.core_highlights.map((h) => (
                      <li key={h} className="flex items-start gap-1.5 text-ink/70">
                        <CheckCircle2 className="mt-0.5 shrink-0 text-fern" size={12} />{h}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Tailored content tab */}
          {activeTab === "tailored" && app.stage2_content && (
            <Stage2Panel content={app.stage2_content} />
          )}
          {activeTab === "tailored" && !app.stage2_content && (
            <p className="rounded-md bg-ink/5 px-4 py-6 text-center text-sm text-ink/40">
              Stage 2 tailoring hasn't run yet — upload a JD file to trigger the full pipeline.
            </p>
          )}

          {/* Notes tab */}
          {activeTab === "notes" && (
            <div className="space-y-2">
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this application — recruiter name, interview prep, salary range…"
                className="w-full resize-y rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm placeholder:text-ink/25 focus:border-moss focus:outline-none" />
              <div className="flex items-center gap-3">
                <button onClick={saveNotes} disabled={notesSaving}
                  className="flex items-center gap-1.5 rounded-md bg-ink/5 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/10 transition-colors disabled:opacity-50">
                  {notesSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  {notesSaving ? "Saving…" : "Save notes"}
                </button>
                {notesSaved && <span className="flex items-center gap-1 text-xs text-fern"><CheckCircle2 size={11} /> Saved</span>}
              </div>
            </div>
          )}

          {/* Downloads */}
          {(app.docx_url || app.pdf_url) && (
            <div className="flex gap-3 pt-1">
              {app.docx_url && (
                <a href={app.docx_url}
                  className="flex items-center gap-1.5 rounded-md border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5">
                  <Download size={13} /> Download DOCX
                </a>
              )}
              {app.pdf_url && (
                <a href={app.pdf_url}
                  className="flex items-center gap-1.5 rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-white">
                  <Download size={13} /> Download PDF
                </a>
              )}
            </div>
          )}

          {/* Error */}
          {app.status === "error" && app.error_message && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              <XCircle className="mr-1 inline" size={12} />
              {app.error_message.slice(0, 300)}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main Tracker page
// ---------------------------------------------------------------------------
export default function Tracker() {
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const { apiUrl: API_URL, status: backendStatus } = useBackendStatus();

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    fetchAll();
    const channel = supabase.channel("tracker-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_applications" }, (payload) => {
        const updated = payload.new as JobApplication;
        setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchAll() {
    setLoading(true);
    const [appsRes, resumesRes] = await Promise.all([
      supabase.from("job_applications").select("*").order("created_at", { ascending: false }),
      supabase.from("resumes").select("*").order("created_at", { ascending: false }),
    ]);
    setApps((appsRes.data as JobApplication[]) ?? []);
    setResumes((resumesRes.data as Resume[]) ?? []);
    setLoading(false);
  }

  async function updateStatus(id: string, status: ApplicationStatus) {
    await supabase.from("job_applications").update({ status }).eq("id", id);
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  }

  async function saveNotes(id: string, notes: string) {
    await supabase.from("job_applications").update({ notes }).eq("id", id);
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, notes } : a)));
  }

  // Filtering
  const filtered = apps.filter((a) => {
    const matchesSearch = !search ||
      a.company_name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const counts = (Object.keys(STATUS_CONFIG) as ApplicationStatus[]).reduce(
    (acc, s) => ({ ...acc, [s]: apps.filter((a) => a.status === s).length }),
    {} as Record<ApplicationStatus, number>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between border-b border-ink/10 pb-5">
        <div>
          <p className="text-sm font-semibold text-moss">DocMind</p>
          <h1 className="mt-1 text-3xl font-semibold text-ink">Application Tracker</h1>
        </div>
        <div className="flex items-center gap-2">
          {apps.length > 0 && (
            <button onClick={() => exportToCSV(apps)}
              className="flex items-center gap-1.5 rounded-md border border-ink/15 px-3 py-2 text-sm text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors">
              <Download size={14} /> Export CSV
            </button>
          )}
          <button onClick={() => setShowModal(true)} disabled={!isSupabaseConfigured}
            className="flex items-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-semibold text-white disabled:bg-ink/25">
            <PlusCircle size={16} /> Add Application
          </button>
        </div>
      </header>

      {!isSupabaseConfigured && (
        <div className="mb-6 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-ink/70">
          <strong>Supabase not configured.</strong> Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </div>
      )}

      {/* Backend health banner */}
      {backendStatus === "offline" && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/5 px-4 py-2.5 text-sm text-amber">
          <WifiOff size={14} />
          {API_URL
            ? "Local backend unreachable — start FastAPI + Cloudflare Tunnel then refresh."
            : <>Set <code className="font-mono text-xs">VITE_DOCMIND_API_URL</code> to your Cloudflare tunnel URL.</>}
        </div>
      )}

      {/* Quick Skills Check */}
      <QuickSkillsPanel
        resumes={resumes}
        existingApps={apps}
        backendStatus={backendStatus}
        apiUrl={API_URL}
        onAdded={fetchAll}
      />

      {/* Pipeline summary */}
      {apps.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["to_apply", "applied", "interview", "offer"] as ApplicationStatus[]).map((s) => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`rounded-lg border p-3 text-center transition-all ${
                statusFilter === s
                  ? "border-moss/40 ring-1 ring-moss/30"
                  : "border-ink/10"
              } ${STATUS_CONFIG[s].bg}`}>
              <p className={`text-2xl font-bold ${STATUS_CONFIG[s].color}`}>{counts[s]}</p>
              <p className="text-xs text-ink/50">{STATUS_CONFIG[s].label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Filter/search bar */}
      {apps.length > 0 && (
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company or role…"
              className="w-full rounded-md border border-ink/15 bg-white py-2 pl-9 pr-3 text-sm focus:border-moss focus:outline-none" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}
            className="rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/70">
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_CONFIG) as ApplicationStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
          {(search || statusFilter !== "all") && (
            <button onClick={() => { setSearch(""); setStatusFilter("all"); }}
              className="rounded-md px-3 py-2 text-sm text-ink/40 hover:text-ink">Clear</button>
          )}
        </div>
      )}

      {loading ? (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="animate-pulse rounded-lg border border-ink/10 bg-white/80 px-4 py-3 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="h-[18px] w-[18px] shrink-0 rounded bg-ink/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/5 rounded bg-ink/10" />
                  <div className="h-2.5 w-1/4 rounded bg-ink/5" />
                </div>
                <div className="h-6 w-24 shrink-0 rounded-full bg-ink/10" />
              </div>
            </li>
          ))}
        </ul>
      ) : filtered.length === 0 && apps.length > 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-ink/40">
          <Filter size={32} className="mb-3" />
          <p className="text-lg">No matches</p>
          <p className="mt-1 text-sm">Try a different search or status filter.</p>
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-ink/40">
          <Briefcase size={40} className="mb-3" />
          <p className="text-lg">No applications yet.</p>
          <p className="mt-1 text-sm">Add your first application to start tracking.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((app) => (
            <ApplicationRow key={app.id} app={app} onStatusChange={updateStatus} onNotesSave={saveNotes} />
          ))}
        </ul>
      )}

      {search === "" && statusFilter !== "all" && filtered.length < apps.length && (
        <p className="mt-3 text-center text-xs text-ink/40">
          Showing {filtered.length} of {apps.length} applications
        </p>
      )}

      {showModal && (
        <AddAppModal
          resumes={resumes}
          existingApps={apps}
          onClose={() => setShowModal(false)}
          onAdded={fetchAll}
        />
      )}
    </div>
  );
}
