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
  withStatusDate,
} from "../lib/supabase";

import { useBackendStatus, type BackendStatus } from "../lib/useBackendStatus";
import { BackendStatusDot } from "../components/BackendStatusDot";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { AnalyticsDashboard } from "../components/AnalyticsDashboard";

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
  closed:             { label: "Closed",    color: "text-ink/50",  bg: "bg-ink/10" },
};
const PIPELINE_STATUSES: ApplicationStatus[] = ["pending_processing", "processing", "stage1_complete", "ready"];

function formatStatusDate(date?: string | null): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function statusLabelWithDate(status: ApplicationStatus, app?: JobApplication): string {
  const date = app?.status_dates?.[status];
  return date ? `${STATUS_CONFIG[status].label} — ${formatStatusDate(date)}` : STATUS_CONFIG[status].label;
}

async function openStorageUrl(bucket: string, value: string) {
  if (/^https?:\/\//.test(value)) {
    window.open(value, "_blank", "noopener,noreferrer");
    return;
  }
  const path = value.replace(`${bucket}:`, "");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Unable to create download link.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function matchScoreAccent(score: number): string {
  if (score >= 75) return "text-fern border-fern/40";
  if (score >= 50) return "text-amber border-amber/40";
  return "text-red-500 border-red-300";
}

const LOADING_STAGES = [
  "Extracting Job Description...",
  "Mapping skills against the FAANG hiring bar...",
  "Identifying critical skill gaps...",
  "Generating actionable project recommendations...",
  "Finalizing analysis...",
];

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
        <div className="rounded-xl border border-ink/10 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide">Cover Letter Opening</p>
            <CopyButton text={content.cover_letter_opening} label="Copy paragraph" />
          </div>
          <p className="text-sm leading-relaxed text-ink/80 italic">"{content.cover_letter_opening}"</p>
        </div>
      )}

      {/* Tailored summary */}
      {content.tailored_summary && (
        <div className="rounded-xl border border-ink/10 bg-white p-3">
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
              <div key={i} className="grid grid-cols-2 gap-3 rounded-xl border border-ink/10 bg-white p-4 text-xs">
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
          <div className="flex flex-wrap gap-1.5 mt-1">
            {content.skills_to_add?.map((s) => (
              <span key={s} className="rounded-full bg-signal/10 px-2.5 py-1 text-[11px] font-semibold text-signal">{s}</span>
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
  const [jdUrl, setJdUrl] = useState("");
  const [jdInputMode, setJdInputMode] = useState<"text" | "url">("text");
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
  const canAnalyse = resumeText.trim().length > 0 && (jdInputMode === "url" ? jdUrl.trim().length > 0 : jdText.trim().length > 0);

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
    if (!resumeText.trim()) {
      setErr("Paste your resume text first.");
      return;
    }
    if (jdInputMode === "text" && !jdText.trim()) {
      setErr("Paste the job description text or switch to URL mode.");
      return;
    }
    if (jdInputMode === "url" && !jdUrl.trim()) {
      setErr("Enter the job description URL or switch to text mode.");
      return;
    }
    setLoading(true); setErr(null); setResult(null); setShowTrack(false); setSaved(false); setLoadingStage(0);
    const stageTimer = setInterval(() => {
      setLoadingStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1));
    }, 2500);
    try {
      const payload: Record<string, string> = {
        resume_text: resumeText,
        company: trackForm.company,
        role: trackForm.role,
      };
      if (jdInputMode === "url") {
        payload.jd_url = jdUrl.trim();
      } else {
        payload.jd_text = jdText.trim();
      }
      const res = await fetch(`${API_URL}/extract-skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        const loadedApp = existingApps.find((a) => a.id === loadedApplicationId);
        const { error } = await supabase.from("job_applications").update({
          resume_id: trackForm.resume_id,
          status: "stage1_complete",
          status_dates: withStatusDate(loadedApp?.status_dates, "stage1_complete"),
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
          status_dates: withStatusDate(undefined, "stage1_complete"),
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
    navigator.clipboard.writeText(result.missing_keywords?.join(", ")).then(() => {
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
                className="w-full resize-y rounded-xl border border-ink/15 bg-paper px-3 py-2.5 text-sm placeholder:text-ink/25 focus:border-moss focus:ring-2 focus:ring-moss/10 focus:outline-none transition-all" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-ink/50">Job Description</label>
                <div className="flex items-center gap-0.5 rounded-lg border border-ink/10 bg-ink/5 p-0.5">
                  <button
                    onClick={() => setJdInputMode("text")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                      jdInputMode === "text"
                        ? "bg-white text-ink shadow-sm"
                        : "text-ink/40 hover:text-ink/70"
                    }`}
                  >
                    Paste Text
                  </button>
                  <button
                    onClick={() => setJdInputMode("url")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                      jdInputMode === "url"
                        ? "bg-white text-ink shadow-sm"
                        : "text-ink/40 hover:text-ink/70"
                    }`}
                  >
                    <ExternalLink size={10} className="inline mr-1 -mt-0.5" />URL
                  </button>
                </div>
              </div>
              {jdInputMode === "text" ? (
                <textarea rows={10} value={jdText} onChange={(e) => setJdText(e.target.value)}
                  placeholder="Paste the job description here…"
                  className="w-full resize-y rounded-xl border border-ink/15 bg-paper px-3 py-2.5 text-sm placeholder:text-ink/25 focus:border-moss focus:ring-2 focus:ring-moss/10 focus:outline-none transition-all" />
              ) : (
                <div className="flex flex-col gap-2 h-full">
                  <input
                    type="url"
                    value={jdUrl}
                    onChange={(e) => setJdUrl(e.target.value)}
                    placeholder="https://jobs.company.com/opening/..."
                    className="w-full rounded-xl border border-ink/15 bg-paper px-3 py-2.5 text-sm placeholder:text-ink/25 focus:border-moss focus:ring-2 focus:ring-moss/10 focus:outline-none transition-all"
                  />
                  <p className="text-[11px] text-ink/40 leading-relaxed mt-1">
                    The AI will fetch and extract the job description text automatically.
                    Works best with standard job pages (LinkedIn, Indeed, Greenhouse, Lever).
                    Some ATS portals may be restricted.
                  </p>
                </div>
              )}
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
                    {result.missing_keywords?.map((kw) => (
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
                    {result.matched_skills?.map((s) => (
                      <span key={s} className="rounded-full bg-fern/15 px-2.5 py-0.5 text-xs font-medium text-fern">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.core_highlights.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">Strongest selling points</p>
                  <ul className="space-y-1">
                    {result.core_highlights?.map((h) => (
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
                    {(result as any).skills_to_add?.map((s: string) => (
                      <span key={s} className="rounded-full bg-signal/10 px-2.5 py-0.5 text-xs font-medium text-signal">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.recommended_projects.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-ink/50 uppercase tracking-wide">Suggested Skill-Gap Projects</p>
                  <div className="space-y-2">
                    {result.recommended_projects?.map((p) => (
                      <div key={p.project_title} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <p className="font-semibold text-ink">{p.project_title}</p>
                          <div className="flex flex-wrap justify-end gap-1 shrink-0">
                            {p.skills_targeted?.map(s => (
                              <span key={s} className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-amber">{s}</span>
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-ink/60 mt-1.5 leading-relaxed">{p.one_line_description}</p>
                        <p className="mt-2 text-[11px] font-mono text-moss/80 bg-moss/5 rounded px-2 py-1 inline-block">
                          {p.suggested_tech_stack?.join(" · ")}
                        </p>
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
  onAdded: (id: string) => void;
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
      const initialStatus: ApplicationStatus = jdStoragePath ? "pending_processing" : "to_apply";
      const { error } = await supabase.from("job_applications").insert({
        user_id: userId,
        resume_id: form.resume_id,
        company_name: form.company_name,
        role: form.role,
        jd_url: form.jd_url || null,
        jd_storage_path: jdStoragePath,
        status: initialStatus,
        status_dates: withStatusDate(undefined, initialStatus),
        application_date: new Date().toISOString().split("T")[0],
      });
      if (error) throw new Error(error.message);
      
      const { data } = await supabase
        .from("job_applications")
        .select("id")
        .eq("user_id", userId)
        .eq("company_name", form.company_name)
        .eq("role", form.role)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
        
      if (data) {
        onAdded(data.id);
      } else {
        onAdded(""); // Fallback
      }
      onClose();
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
            <p className="rounded-xl bg-amber/10 px-4 py-3 text-sm text-amber shadow-sm">
              Upload a resume first (Resumes tab) and wait for it to be processed.
            </p>
          )}
          <div>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-ink/60">
              Base Resume *
              {form.resume_id && <CheckCircle2 size={12} className="text-fern" />}
            </label>
            <select value={form.resume_id} onChange={(e) => setForm({ ...form, resume_id: e.target.value })}
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm shadow-sm focus:border-moss focus:outline-none">
              {ready.map((r) => <option key={r.id} value={r.id}>{r.original_filename}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/60">Company *</label>
              <input value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                onBlur={checkDuplicate}
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm shadow-sm focus:border-moss focus:outline-none" placeholder="Acme Corp" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/60">Role *</label>
              <input value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                onBlur={checkDuplicate}
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm shadow-sm focus:border-moss focus:outline-none" placeholder="Senior Engineer" />
            </div>
          </div>
          {dupWarning && (
            <p className="rounded-lg bg-amber/10 px-3 py-2 text-sm text-amber shadow-sm">⚠ {dupWarning}</p>
          )}
          <div>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-ink/60">
              JD URL (optional)
              {form.jd_url && !jdFile && <CheckCircle2 size={12} className="text-fern" />}
            </label>
            <input value={form.jd_url} onChange={(e) => setForm({ ...form, jd_url: e.target.value })}
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm shadow-sm focus:border-moss focus:outline-none" placeholder="https://jobs.example.com/..." />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-ink/60">
              Upload JD file (PDF/DOCX) — triggers AI tailoring
              {jdFile && <CheckCircle2 size={12} className="text-fern" />}
            </label>
            <input type="file" accept=".pdf,.docx,.txt"
              onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm shadow-sm file:mr-2 file:rounded file:border-0 file:bg-moss file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white" />
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 shadow-sm">{err}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-ink/10 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving || ready.length === 0}
            className="flex items-center gap-2 rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:bg-ink/25 transition-colors">
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
  highlighted = false,
}: {
  app: JobApplication;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onNotesSave: (id: string, notes: string) => void;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(highlighted);
  const [notes, setNotes] = useState(app.notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [showAppliedToast, setShowAppliedToast] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"analysis" | "tailored" | "jd" | "notes">("analysis");
  const cfg = STATUS_CONFIG[app.status];
  const statusTimeline = (Object.keys(STATUS_CONFIG) as ApplicationStatus[])
    .map((status) => ({ status, date: app.status_dates?.[status] }))
    .filter((item): item is { status: ApplicationStatus; date: string } => Boolean(item.date));

  useEffect(() => {
    if (highlighted) setExpanded(true);
  }, [highlighted]);

  async function handleDocxDownload() {
    if (!app.docx_url || downloadingDocx) return;
    setDownloadingDocx(true);
    setDownloadError(null);
    try {
      await openStorageUrl("tailored-resumes", app.docx_url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloadingDocx(false);
    }
  }
  const currentStatusDate = app.status_dates?.[app.status];
  const isProcessing = PIPELINE_STATUSES.includes(app.status) && app.status !== "ready";
  const showMarkAppliedCTA = app.status === "ready" || app.status === "stage1_complete";

  function handleMarkApplied() {
    onStatusChange(app.id, "applied");
    setShowAppliedToast(true);
    setTimeout(() => setShowAppliedToast(false), 3000);
  }

  async function saveNotes() {
    setNotesSaving(true);
    await onNotesSave(app.id, notes);
    setNotesSaving(false);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  // Close status popover on outside click
  useEffect(() => {
    if (!statusOpen) return;
    function handleOutside(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [statusOpen]);

  return (
    <li className={`rounded-xl border bg-white shadow-sm transition-shadow duration-150 ${highlighted ? "border-moss/40 ring-2 ring-moss/15 shadow-moss/5" : "border-ink/10 hover:shadow-md hover:border-ink/20"}`}>
      {/* ── Row header: two independent click zones ── */}
      <div className="flex items-center gap-3 px-4 py-3.5">

        {/* LEFT ZONE — clicking here toggles expand/collapse */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex flex-1 min-w-0 items-center gap-3 text-left"
        >
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.bg} transition-colors`}>
            <Briefcase className={cfg.color} size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink leading-tight">
              {app.role}
            </p>
            <p className="truncate text-xs text-ink/50 mt-0.5">
              {app.company_name}
              {app.application_date && (
                <span className="ml-2 text-ink/35">
                  {new Date(app.application_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
              {app.match_score != null && (
                <span className={`ml-2 font-semibold ${matchScoreAccent(app.match_score)}`}>
                  {app.match_score}%
                </span>
              )}
            </p>
          </div>
        </button>

        {/* RIGHT ZONE — status pill (click to change) + chevron (click to expand) */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Status pill — clicking opens popover, does NOT toggle row */}
          <div ref={statusRef} className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setStatusOpen(o => !o); }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-80 ${cfg.color} ${cfg.bg}`}
            >
              {isProcessing && <Loader2 className="animate-spin" size={11} />}
              {cfg.label}
            </button>
            {statusOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-ink/10 bg-white py-1 shadow-xl">
                {(Object.keys(STATUS_CONFIG) as ApplicationStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatusChange(app.id, s);
                      setStatusOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-ink/5 ${app.status === s ? "bg-ink/5" : ""}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_CONFIG[s].bg.replace("bg-", "bg-").replace("/10", "").replace("/5", "")} ${STATUS_CONFIG[s].color.replace("text-", "bg-")}`} />
                    {STATUS_CONFIG[s].label}
                    {app.status === s && <CheckCircle2 size={11} className="ml-auto text-moss" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Expand/collapse chevron button */}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink/30 transition-colors hover:bg-ink/5 hover:text-ink/60"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-ink/10 px-5 pb-5 pt-4 space-y-4">

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2">
            {app.jd_url && (
              <a href={app.jd_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink/12 px-2.5 py-1.5 text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors">
                <ExternalLink size={12} /> Source JD
              </a>
            )}
            {statusTimeline.length > 0 && (
              <p className="ml-auto text-[11px] text-ink/35 hidden sm:block">
                {statusTimeline.map(({ status, date }) => `${STATUS_CONFIG[status].label}: ${formatStatusDate(date)}`).join(" · ")}
              </p>
            )}
            {showMarkAppliedCTA && !showAppliedToast && (
              <button onClick={handleMarkApplied}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-fern px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-fern/90 transition-colors">
                <CheckCircle2 size={12} /> Mark as Applied
              </button>
            )}
            {showAppliedToast && (
              <div className="ml-auto flex items-center gap-1.5 rounded-lg bg-fern/10 px-3 py-1.5 text-xs font-medium text-fern">
                <CheckCircle2 size={12} /> Marked applied!
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 rounded-xl border border-ink/10 bg-ink/[0.03] p-1">
            {[
              { id: "analysis" as const, label: "AI Analysis", show: Boolean(app.stage1_analysis) },
              { id: "tailored" as const, label: "Tailored Resume", show: Boolean(app.stage2_content) || isProcessing },
              { id: "jd" as const, label: "Job Description", show: Boolean(app.jd_content || app.jd_url) },
              { id: "notes" as const, label: "Notes", show: true },
            ].filter((t) => t.show).map((t) => (
              <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeTab === t.id ? "bg-white shadow-sm text-ink font-semibold" : "text-ink/45 hover:text-ink/70"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Analysis tab */}
          {activeTab === "analysis" && app.stage1_analysis && (
            <div className="rounded-xl border border-ink/10 bg-paper p-4 text-sm">
              {/* Score + pitch row */}
              <div className="flex items-start gap-4 mb-4 pb-4 border-b border-ink/8">
                <ScoreCircle score={app.stage1_analysis.match_score} />
                <div className="flex-1 min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-moss">FAANG-Standard AI Analysis</p>
                    <p className="text-[10px] text-ink/35">
                      Last analysed {new Date(app.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <p className="text-ink/70 italic text-xs leading-relaxed">"{app.stage1_analysis.one_line_pitch}"</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* Matched Skills */}
                <div className="rounded-xl border border-fern/15 bg-fern/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-fern/70 uppercase tracking-wide">Matched Skills</p>
                    {app.stage1_analysis.matched_skills?.length > 0 && (
                      <CopyButton text={app.stage1_analysis.matched_skills?.join(", ")} label="" />
                    )}
                  </div>
                  {app.stage1_analysis.matched_skills?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {app.stage1_analysis.matched_skills?.map((s) => (
                        <span key={s} className="rounded-full bg-fern/15 px-2.5 py-0.5 text-xs font-medium text-fern">{s}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-ink/30 italic">None matched</p>
                  )}
                </div>

                {/* Missing Keywords */}
                <div className="rounded-xl border border-amber/15 bg-amber/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-amber/70 uppercase tracking-wide">ATS Gaps</p>
                    {app.stage1_analysis.missing_keywords?.length > 0 && (
                      <CopyButton text={app.stage1_analysis.missing_keywords?.join(", ")} label="" />
                    )}
                  </div>
                  {app.stage1_analysis.missing_keywords?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {app.stage1_analysis.missing_keywords?.map((kw) => (
                        <span key={kw} className="rounded-full bg-amber/15 px-2.5 py-0.5 text-xs font-medium text-amber">{kw}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-ink/30 italic">No gaps found</p>
                  )}
                </div>

                {/* Core Strengths */}
                {app.stage1_analysis.core_highlights?.length > 0 && (
                  <div className="rounded-xl border border-moss/15 bg-moss/5 p-3">
                    <p className="text-xs font-semibold text-moss/70 uppercase tracking-wide mb-2">Core Strengths</p>
                    <ul className="space-y-1.5">
                      {app.stage1_analysis.core_highlights?.map((h) => (
                        <li key={h} className="flex items-start gap-1.5 text-xs text-ink/70 leading-relaxed">
                          <CheckCircle2 className="mt-0.5 shrink-0 text-moss" size={11} />{h}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {app.stage1_analysis.recommended_projects?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ink/50 uppercase tracking-wide mb-2 mt-1">Suggested Skill-Gap Projects</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {app.stage1_analysis.recommended_projects?.map((p) => (
                      <div key={p.project_title} className="rounded-xl border border-ink/10 bg-white p-3.5 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold text-ink text-xs leading-snug">{p.project_title}</p>
                          <div className="flex flex-wrap justify-end gap-1 shrink-0">
                            {p.skills_targeted?.map(s => (
                              <span key={s} className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber">{s}</span>
                            ))}
                          </div>
                        </div>
                        <p className="text-[11px] text-ink/55 mt-2 leading-relaxed">{p.one_line_description}</p>
                        {p.suggested_tech_stack?.length > 0 && (
                          <p className="mt-2 text-[10px] font-mono text-moss/80 bg-moss/5 rounded px-2 py-1 inline-block">
                            {p.suggested_tech_stack?.join(" · ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tailored content tab */}
          {activeTab === "tailored" && app.stage2_content && (
            <Stage2Panel content={app.stage2_content} />
          )}
          {activeTab === "tailored" && !app.stage2_content && isProcessing && (
            <div className="space-y-4 animate-pulse">
              <div className="rounded-md border border-ink/10 bg-white p-3">
                <div className="mb-3 h-3 w-32 rounded bg-ink/10" />
                <div className="space-y-2">
                  <div className="h-2.5 w-full rounded bg-ink/5" />
                  <div className="h-2.5 w-5/6 rounded bg-ink/5" />
                  <div className="h-2.5 w-4/5 rounded bg-ink/5" />
                </div>
              </div>
              <div className="rounded-md border border-ink/10 bg-white p-3">
                <div className="mb-3 h-3 w-28 rounded bg-ink/10" />
                <div className="space-y-2">
                  <div className="h-2.5 w-full rounded bg-ink/5" />
                  <div className="h-2.5 w-11/12 rounded bg-ink/5" />
                  <div className="h-2.5 w-3/4 rounded bg-ink/5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-ink/10 bg-white p-3 h-24" />
                <div className="rounded-md border border-ink/10 bg-white p-3 h-24" />
              </div>
            </div>
          )}
          {activeTab === "tailored" && !app.stage2_content && !isProcessing && (
            <p className="rounded-md bg-ink/5 px-4 py-6 text-center text-sm text-ink/40">
              Stage 2 tailoring hasn't run yet — upload a JD file to trigger the full pipeline.
            </p>
          )}

          {/* JD tab */}
          {activeTab === "jd" && (
            <div className="rounded-xl border border-ink/10 bg-paper p-4 text-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Saved Job Description</p>
                {app.jd_content && <CopyButton text={app.jd_content} label="Copy JD" />}
              </div>
              {app.jd_content ? (
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink/5 bg-white p-4 font-mono text-xs leading-relaxed text-ink/70">
                  {app.jd_content}
                </pre>
              ) : app.jd_url ? (
                <p className="text-sm text-ink/50">Only a source URL is saved for this application.</p>
              ) : (
                <p className="text-sm text-ink/40">No JD content saved yet. Convert a JD and attach it from the Convert tab.</p>
              )}
            </div>
          )}

          {/* Notes tab */}
          {activeTab === "notes" && (
            <div className="space-y-3">
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this application — recruiter name, interview prep, salary range…"
                className="w-full resize-y rounded-xl border border-ink/15 bg-paper px-4 py-3 text-sm placeholder:text-ink/30 focus:border-moss focus:ring-2 focus:ring-moss/10 focus:outline-none transition-all shadow-sm" />
              <div className="flex items-center gap-3 px-1">
                <button onClick={saveNotes} disabled={notesSaving}
                  className="flex items-center gap-1.5 rounded-lg bg-ink/5 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/10 transition-colors disabled:opacity-50">
                  {notesSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  {notesSaving ? "Saving…" : "Save notes"}
                </button>
                {notesSaved && <span className="flex items-center gap-1 text-xs text-fern"><CheckCircle2 size={11} /> Saved</span>}
              </div>
            </div>
          )}

          {/* Downloads */}
          {(app.docx_url || app.pdf_url) && (
            <div className="flex gap-2 pt-2 border-t border-ink/5 mt-4">
              {app.docx_url && (
                <button type="button" onClick={handleDocxDownload} disabled={downloadingDocx}
                  className="flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5 disabled:opacity-50 shadow-sm transition-colors">
                  {downloadingDocx ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download DOCX
                </button>
              )}
              {app.pdf_url && (
                <a href={app.pdf_url}
                  className="flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-signal/90 transition-colors">
                  <Download size={13} /> Download PDF
                </a>
              )}
            </div>
          )}

          {downloadError && (
            <p className="text-xs text-red-500">{downloadError}</p>
          )}

          {/* Error */}
          {app.status === "error" && app.error_message && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm mt-3">
              <XCircle className="mr-1.5 inline -mt-0.5" size={14} />
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
  const [highlightedId, setHighlightedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("application_id")
  );
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
    const app = apps.find((a) => a.id === id);
    const statusDates = withStatusDate(app?.status_dates, status);
    await supabase.from("job_applications").update({ status, status_dates: statusDates }).eq("id", id);
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, status, status_dates: statusDates } : a)));

    // Trigger animations and motivational toasts based on the new status
    if (status === "offer") {
      toast.success("Incredible! You got an offer! 🎉", {
        description: "Celebrate this massive milestone. Your hard work paid off!",
        duration: 5000,
      });
      const duration = 3000;
      const end = Date.now() + duration;
      const frame = () => {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#4caf7d', '#f5a623', '#2563eb', '#f472b6'] });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#4caf7d', '#f5a623', '#2563eb', '#f472b6'] });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    } else if (status === "interviewing") {
      toast("You're moving forward! 🔥", {
        description: "Time to prep. You have the skills, now go crush that interview!",
        duration: 4000,
      });
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ['#f5a623', '#2563eb', '#ffffff'] });
    } else if (status === "rejected") {
      toast("Keep pushing forward 💪", {
        description: "Every rejection is a redirection. The right role is out there waiting for you!",
        duration: 5000,
      });
      // A subdued but upward-moving burst to symbolize bouncing back
      confetti({ particleCount: 40, spread: 100, origin: { y: 0.4 }, colors: ['#9ca3af', '#6b7280', '#eab308'], gravity: 1.2, scalar: 0.8, ticks: 150 });
    } else if (status === "applied") {
      toast.success("Application sent! 🚀", {
        description: "The first step is done. Keep the momentum going!",
        duration: 3000,
      });
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 }, colors: ['#4caf7d', '#10b981'], gravity: 0.6 });
    } else if (status === "closed") {
      toast("Role closed", {
        description: "Dust it off and on to the next one.",
        duration: 3000,
      });
    }
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

  const inProgressCount = PIPELINE_STATUSES.reduce((sum, s) => sum + counts[s], 0) + counts.interview;
  const completedCount = counts.applied + counts.rejected + counts.closed;
  const processingCount = counts.pending_processing + counts.processing;
  const averageScore = apps.filter(a => a.match_score != null).length > 0
    ? Math.round(apps.filter(a => a.match_score != null).reduce((s, a) => s + (a.match_score ?? 0), 0) / apps.filter(a => a.match_score != null).length)
    : null;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8 border-b border-ink/10 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-moss">DocMind</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">Application Tracker</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/60 shadow-sm">
              <BackendStatusDot status={backendStatus} apiUrl={API_URL ?? ""} />
              {processingCount > 0 ? (
                <span className="text-signal animate-pulse">Processing {processingCount} app{processingCount !== 1 ? 's' : ''}...</span>
              ) : (
                <span>{backendStatus === "connected" ? "AI Ready" : backendStatus === "offline" ? "AI Offline" : "Connecting..."}</span>
              )}
            </div>
            <div className="h-6 w-px bg-ink/10" />
            {apps.length > 0 && (
              <button onClick={() => exportToCSV(apps)}
                className="flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-2 text-sm text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors shadow-sm">
                <Download size={14} /> Export CSV
              </button>
            )}
            <button onClick={() => setShowModal(true)} disabled={!isSupabaseConfigured}
              className="flex items-center gap-2 rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-moss/90 transition-colors disabled:bg-ink/25">
              <PlusCircle size={16} /> Add Application
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {apps.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-ink/8 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">Total Tracked</p>
              <p className="mt-0.5 text-2xl font-bold text-ink">{apps.length}</p>
            </div>
            <div className="rounded-xl border border-ink/8 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">In Progress</p>
              <p className="mt-0.5 text-2xl font-bold text-amber">{inProgressCount}</p>
            </div>
            <div className="rounded-xl border border-ink/8 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">Offers</p>
              <p className="mt-0.5 text-2xl font-bold text-fern">{counts.offer}</p>
            </div>
            <div className="rounded-xl border border-ink/8 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">Avg. Match Score</p>
              <p className={`mt-0.5 text-2xl font-bold ${averageScore != null ? matchScoreAccent(averageScore) : "text-ink/30"}`}>
                {averageScore != null ? `${averageScore}%` : "—"}
              </p>
            </div>
          </div>
        )}
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
        <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {(["to_apply", "applied", "interview", "offer", "rejected", "closed"] as ApplicationStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`rounded-xl border p-3 text-center transition-all hover:shadow-md ${
                statusFilter === s
                  ? `${STATUS_CONFIG[s].bg} border-current shadow-sm ring-1 ring-current/30`
                  : "border-ink/10 bg-white hover:border-ink/20"
              } ${STATUS_CONFIG[s].color}`}
            >
              <p className="text-2xl font-bold">{counts[s]}</p>
              <p className="text-[11px] font-medium opacity-70 mt-0.5">{STATUS_CONFIG[s].label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Analytics Dashboard */}
      {apps.length > 0 && <AnalyticsDashboard apps={apps} />}

      {/* Filter/search bar */}
      {apps.length > 0 && (
        <div className="mb-5 flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company or role…"
              className="w-full rounded-xl border border-ink/15 bg-white py-2.5 pl-10 pr-3 text-sm shadow-sm focus:border-moss focus:ring-2 focus:ring-moss/10 focus:outline-none transition-all" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}
            className="rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink/70 shadow-sm focus:border-moss focus:outline-none">
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_CONFIG) as ApplicationStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
          {(search || statusFilter !== "all") && (
            <button onClick={() => { setSearch(""); setStatusFilter("all"); }}
              className="rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink/50 hover:text-ink shadow-sm transition-colors">Clear</button>
          )}
        </div>
      )}

      {loading ? (
        <ul className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="animate-pulse rounded-xl border border-ink/10 bg-white/80 px-5 py-4 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="h-9 w-9 shrink-0 rounded-full bg-ink/8" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/5 rounded-full bg-ink/10" />
                  <div className="h-2.5 w-1/4 rounded-full bg-ink/6" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-6 w-20 shrink-0 rounded-full bg-ink/8" />
                  <div className="h-7 w-7 shrink-0 rounded-md bg-ink/6" />
                </div>
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
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink/10 bg-white/50 px-6 py-24 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss">
            <Sparkles size={32} />
          </div>
          <h2 className="text-xl font-semibold text-ink">Let's get started</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink/60">
            Track your job hunt, get AI-tailored resumes, and discover skill-gap project ideas. Add your first application to begin.
          </p>
          <button onClick={() => setShowModal(true)} disabled={!isSupabaseConfigured}
            className="mt-6 flex items-center gap-2 rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100">
            <PlusCircle size={16} /> Add Your First Application
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((app) => (
            <ApplicationRow
              key={app.id}
              app={app}
              onStatusChange={updateStatus}
              onNotesSave={saveNotes}
              highlighted={app.id === highlightedId}
            />
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
          onAdded={(id) => {
            fetchAll();
            if (id) setHighlightedId(id);
          }}
        />
      )}
    </div>
  );
}
