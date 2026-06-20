import { useEffect, useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  PlusCircle,
  XCircle,
} from "lucide-react";
import {
  supabase,
  isSupabaseConfigured,
  type JobApplication,
  type ApplicationStatus,
  type Resume,
} from "../lib/supabase";

// ---------------------------------------------------------------------------
// Status display config
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<
  ApplicationStatus,
  { label: string; color: string; bg: string }
> = {
  to_apply:            { label: "To Apply",    color: "text-ink/60",    bg: "bg-ink/5" },
  pending_processing:  { label: "Queued",       color: "text-amber",     bg: "bg-amber/10" },
  processing:          { label: "Processing",   color: "text-signal",    bg: "bg-signal/10" },
  stage1_complete:     { label: "Analysed",     color: "text-moss",      bg: "bg-moss/10" },
  ready:               { label: "Ready",        color: "text-fern",      bg: "bg-fern/10" },
  error:               { label: "Error",        color: "text-red-500",   bg: "bg-red-50" },
  applied:             { label: "Applied",      color: "text-signal",    bg: "bg-signal/10" },
  interview:           { label: "Interview",    color: "text-moss",      bg: "bg-moss/10" },
  offer:               { label: "Offer!",       color: "text-fern",      bg: "bg-fern/20" },
  rejected:            { label: "Rejected",     color: "text-ink/40",    bg: "bg-ink/5" },
};

const PIPELINE_STATUSES: ApplicationStatus[] = [
  "pending_processing", "processing", "stage1_complete", "ready"
];

// ---------------------------------------------------------------------------
// Add Application Modal
// ---------------------------------------------------------------------------
function AddAppModal({
  resumes,
  onClose,
  onAdded,
}: {
  resumes: Resume[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    company_name: "",
    role: "",
    jd_url: "",
    resume_id: resumes[0]?.id ?? "",
  });
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!form.company_name || !form.role || !form.resume_id) {
      setErr("Company, role, and resume are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? "anonymous";

      let jdStoragePath: string | null = null;
      if (jdFile) {
        const path = `${userId}/${Date.now()}_${jdFile.name}`;
        const { error } = await supabase.storage
          .from("job-descriptions")
          .upload(path, jdFile);
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
      onAdded();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const ready = resumes.filter((r) => r.status === "ready");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-paper shadow-xl">
        <div className="border-b border-ink/10 px-5 py-4">
          <h2 className="font-semibold text-ink">Add Job Application</h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          {ready.length === 0 && (
            <p className="rounded-md bg-amber/10 px-3 py-2 text-sm text-amber">
              Upload a resume first (Resumes tab) and wait for it to be processed.
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/60">Base Resume *</label>
            <select
              value={form.resume_id}
              onChange={(e) => setForm({ ...form, resume_id: e.target.value })}
              className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"
            >
              {ready.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.original_filename}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/60">Company *</label>
              <input
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/60">Role *</label>
              <input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"
                placeholder="Senior Engineer"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/60">JD URL (optional)</label>
            <input
              value={form.jd_url}
              onChange={(e) => setForm({ ...form, jd_url: e.target.value })}
              className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"
              placeholder="https://jobs.example.com/..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/60">
              Upload JD file (PDF/DOCX) — triggers AI tailoring
            </label>
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm file:mr-2 file:rounded file:border-0 file:bg-moss file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white"
            />
          </div>
          {err && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-ink/10 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-ink/60 hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || ready.length === 0}
            className="flex items-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-semibold text-white disabled:bg-ink/25"
          >
            {saving && <Loader2 className="animate-spin" size={14} />}
            {saving ? "Saving..." : "Add Application"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application row (progressive disclosure — Bonsai Memory pattern)
// ---------------------------------------------------------------------------
function ApplicationRow({ app, onStatusChange }: {
  app: JobApplication;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[app.status];
  const isProcessing = PIPELINE_STATUSES.includes(app.status) && app.status !== "ready";

  return (
    <li className="rounded-lg border border-ink/10 bg-white/80 shadow-sm">
      {/* Row summary — always visible */}
      <div
        className="flex cursor-pointer items-center gap-4 px-4 py-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <Briefcase className="shrink-0 text-ink/30" size={18} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {app.role}{" "}
            <span className="text-ink/50">@ {app.company_name}</span>
          </p>
          <p className="text-xs text-ink/40">
            {app.application_date
              ? new Date(app.application_date).toLocaleDateString()
              : "No date"}
            {app.match_score != null && ` · Match: ${app.match_score}%`}
          </p>
        </div>

        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.color} ${cfg.bg}`}>
          {isProcessing && <Loader2 className="animate-spin" size={11} />}
          {cfg.label}
        </div>

        {expanded ? (
          <ChevronUp size={16} className="shrink-0 text-ink/30" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-ink/30" />
        )}
      </div>

      {/* Progressive disclosure — detail panel */}
      {expanded && (
        <div className="border-t border-ink/10 px-4 py-4 space-y-4">
          {/* Status updater */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-ink/50">Update status:</span>
            <select
              value={app.status}
              onChange={(e) =>
                onStatusChange(app.id, e.target.value as ApplicationStatus)
              }
              className="rounded-md border border-ink/15 bg-paper px-2 py-1 text-sm"
            >
              {(Object.keys(STATUS_CONFIG) as ApplicationStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONFIG[s].label}
                </option>
              ))}
            </select>
            {app.jd_url && (
              <a
                href={app.jd_url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex items-center gap-1 text-xs text-signal hover:underline"
              >
                <ExternalLink size={12} />
                View JD
              </a>
            )}
          </div>

          {/* AI Analysis (Stage 1) */}
          {app.stage1_analysis && (
            <div className="rounded-md border border-ink/10 bg-paper p-3 text-sm space-y-2">
              <p className="font-semibold text-moss">AI Analysis</p>
              <p className="text-ink/70">
                <strong>One-line pitch:</strong>{" "}
                {app.stage1_analysis.one_line_pitch}
              </p>
              {app.stage1_analysis.missing_keywords.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-ink/50 mb-1">Missing keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {app.stage1_analysis.missing_keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded bg-amber/15 px-1.5 py-0.5 text-xs text-amber"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {app.stage1_analysis.matched_skills.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-ink/50 mb-1">Matched skills</p>
                  <div className="flex flex-wrap gap-1">
                    {app.stage1_analysis.matched_skills.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-fern/15 px-1.5 py-0.5 text-xs text-fern"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {app.stage1_analysis.core_highlights.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-ink/50 mb-1">Your strengths for this role</p>
                  <ul className="space-y-0.5">
                    {app.stage1_analysis.core_highlights.map((h) => (
                      <li key={h} className="flex items-start gap-1.5 text-ink/70">
                        <CheckCircle2 className="mt-0.5 shrink-0 text-fern" size={12} />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Download tailored resume */}
          {(app.docx_url || app.pdf_url) && (
            <div className="flex gap-3">
              {app.docx_url && (
                <a
                  href={app.docx_url}
                  className="flex items-center gap-1.5 rounded-md border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5"
                >
                  <Download size={13} />
                  Download DOCX
                </a>
              )}
              {app.pdf_url && (
                <a
                  href={app.pdf_url}
                  className="flex items-center gap-1.5 rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-white"
                >
                  <Download size={13} />
                  Download PDF
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

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    fetchAll();

    // Realtime — update rows in-place as the worker processes them
    const channel = supabase
      .channel("tracker-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_applications" },
        (payload) => {
          const updated = payload.new as JobApplication;
          setApps((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a))
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchAll() {
    setLoading(true);
    const [appsRes, resumesRes] = await Promise.all([
      supabase
        .from("job_applications")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("resumes")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);
    setApps((appsRes.data as JobApplication[]) ?? []);
    setResumes((resumesRes.data as Resume[]) ?? []);
    setLoading(false);
  }

  async function updateStatus(id: string, status: ApplicationStatus) {
    await supabase.from("job_applications").update({ status }).eq("id", id);
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  }

  const counts = (Object.keys(STATUS_CONFIG) as ApplicationStatus[]).reduce(
    (acc, s) => ({ ...acc, [s]: apps.filter((a) => a.status === s).length }),
    {} as Record<ApplicationStatus, number>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between border-b border-ink/10 pb-5">
        <div>
          <p className="text-sm font-semibold text-moss">DocMind</p>
          <h1 className="mt-1 text-3xl font-semibold text-ink">
            Application Tracker
          </h1>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={!isSupabaseConfigured}
          className="flex items-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-semibold text-white disabled:bg-ink/25"
        >
          <PlusCircle size={16} />
          Add Application
        </button>
      </header>

      {!isSupabaseConfigured && (
        <div className="mb-6 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-ink/70">
          <strong>Supabase not configured.</strong> Set{" "}
          <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>.
        </div>
      )}

      {/* Pipeline summary */}
      {apps.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["to_apply", "applied", "interview", "offer"] as ApplicationStatus[]).map(
            (s) => (
              <div
                key={s}
                className={`rounded-lg border border-ink/10 p-3 text-center ${STATUS_CONFIG[s].bg}`}
              >
                <p className={`text-2xl font-bold ${STATUS_CONFIG[s].color}`}>
                  {counts[s]}
                </p>
                <p className="text-xs text-ink/50">{STATUS_CONFIG[s].label}</p>
              </div>
            )
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink/30">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-ink/40">
          <Briefcase size={40} className="mb-3" />
          <p className="text-lg">No applications yet.</p>
          <p className="mt-1 text-sm">
            Add your first application to start tracking.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => (
            <ApplicationRow
              key={app.id}
              app={app}
              onStatusChange={updateStatus}
            />
          ))}
        </ul>
      )}

      {showModal && (
        <AddAppModal
          resumes={resumes}
          onClose={() => setShowModal(false)}
          onAdded={fetchAll}
        />
      )}
    </div>
  );
}
