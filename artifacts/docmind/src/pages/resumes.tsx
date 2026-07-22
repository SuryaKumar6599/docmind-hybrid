import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  CopyCheck,
  Download,
  FileText,
  Loader2,
  Star,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { supabase, isSupabaseConfigured, type Resume, type ResumeStatus } from "../lib/supabase";
import { markdownToXml } from "../lib/markdownToXml";

const STATUS_CONFIG: Record<ResumeStatus, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  pending_processing: { label: "Queued",     color: "text-warning",  bg: "bg-warning/10",  icon: Clock },
  processing:         { label: "Processing", color: "text-primary",  bg: "bg-primary/10",  icon: Loader2 },
  ready:              { label: "Ready",      color: "text-success",  bg: "bg-success/10",  icon: CheckCircle2 },
  error:              { label: "Error",      color: "text-error",    bg: "bg-error/10",    icon: XCircle },
};

function ResumeCard({
  resume,
  onDelete,
  onSetDefault,
}: {
  resume: Resume;
  onDelete: (id: string) => void;
  onSetDefault: (resume: Resume) => void;
}) {
  const cfg = STATUS_CONFIG[resume.status];
  const Icon = cfg.icon;
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [copied, setCopied] = useState(false);

  const wordCount = resume.markdown_content
    ? resume.markdown_content.trim().split(/\s+/).filter(Boolean).length
    : null;

  const dateFormatted = new Date(resume.created_at).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });

  async function handleDelete() {
    if (!window.confirm(`Delete "${resume.original_filename}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const { error: deleteErr } = await supabase.from("resumes").delete().eq("id", resume.id);
      if (deleteErr) {
        window.alert(
          deleteErr.message.includes("foreign key") || deleteErr.code === "23503"
            ? "Can't delete — one or more tailored resumes are based on this one. Delete those first."
            : `Delete failed: ${deleteErr.message}`
        );
        return;
      }
      await supabase.storage.from("resumes").remove([resume.storage_path]);
      onDelete(resume.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSetDefault() {
    if (resume.is_default || settingDefault) return;
    setSettingDefault(true);
    try { await onSetDefault(resume); }
    finally { setSettingDefault(false); }
  }

  function copyMarkdown() {
    if (!resume.markdown_content) return;
    navigator.clipboard.writeText(resume.markdown_content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function downloadText(kind: "markdown" | "xml") {
    if (!resume.markdown_content) return;
    const isMarkdown = kind === "markdown";
    const text = isMarkdown ? resume.markdown_content : markdownToXml(resume.markdown_content, resume.original_filename);
    const blob = new Blob([text], { type: isMarkdown ? "text/markdown" : "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resume.original_filename.replace(/\.[^.]+$/, "")}${isMarkdown ? ".md" : ".xml"}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`group relative flex flex-col rounded-2xl border bg-white dark:bg-white/5 shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
      resume.is_default
        ? "border-success/40 ring-2 ring-success/15"
        : "border-ink/10 hover:border-ink/20"
    }`}>
      {/* Default badge */}
      {resume.is_default && (
        <div className="absolute -top-2.5 left-4">
          <span className="flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">
            <Star size={9} className="fill-white" /> Default
          </span>
        </div>
      )}

      {/* Card header */}
      <div className="flex flex-col items-center px-5 pt-8 pb-5">
        {/* Document icon with status ring */}
        <div className={`relative flex h-16 w-16 items-center justify-center rounded-2xl ${cfg.bg} mb-4`}>
          <FileText size={28} className={cfg.color} />
          {/* Processing spinner overlay */}
          {(resume.status === "processing" || resume.status === "pending_processing") && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
              <Loader2 size={32} className={`animate-spin ${cfg.color} opacity-30`} />
            </div>
          )}
        </div>

        {/* Filename */}
        <p className="text-center text-sm font-semibold text-ink leading-tight line-clamp-2 mb-1.5">
          {resume.original_filename}
        </p>

        {/* Metadata */}
        <p className="text-xs text-body">{dateFormatted}</p>
        {wordCount != null && (
          <p className="text-xs text-body/60 mt-0.5">{wordCount.toLocaleString()} words</p>
        )}

        {/* Status badge */}
        <div className={`mt-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.color} ${cfg.bg}`}>
          <Icon size={11} className={resume.status === "processing" ? "animate-spin" : ""} />
          {cfg.label}
        </div>

        {/* Tailored tag */}
        {resume.parent_resume_id && (
          <span className="mt-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            Tailored version
          </span>
        )}
      </div>

      {/* Action bar */}
      <div className="mt-auto border-t border-ink/8 px-4 py-3">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {/* Set default (base resumes only) */}
          {!resume.parent_resume_id && resume.status === "ready" && !resume.is_default && (
            <button
              onClick={handleSetDefault}
              disabled={settingDefault}
              className="flex items-center gap-1 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[11px] font-medium text-body hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-50"
              title="Set as default for Quick Skills Check"
            >
              <Star size={11} /> Set Default
            </button>
          )}

          {/* Download markdown */}
          <button
            onClick={() => downloadText("markdown")}
            disabled={!resume.markdown_content}
            className="flex items-center gap-1 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[11px] font-medium text-body hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-50"
            title="Download as Markdown"
          >
            <Download size={11} /> .md
          </button>

          {/* Download XML */}
          <button
            onClick={() => downloadText("xml")}
            disabled={!resume.markdown_content}
            className="flex items-center gap-1 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[11px] font-medium text-body hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-50"
            title="Download as XML"
          >
            <Download size={11} /> .xml
          </button>

          {/* Copy */}
          <button
            onClick={copyMarkdown}
            disabled={!resume.markdown_content}
            className="flex items-center gap-1 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[11px] font-medium text-body hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-50"
            title="Copy markdown content"
          >
            {copied ? <CopyCheck size={11} className="text-success" /> : <Copy size={11} />}
            {copied ? "Copied!" : "Copy"}
          </button>

          {/* Delete */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1 rounded-lg border border-error/20 px-2.5 py-1.5 text-[11px] font-medium text-error hover:bg-error/5 transition-colors disabled:opacity-50"
            title="Delete resume"
          >
            <Trash2 size={11} /> {deleting ? "…" : "Delete"}
          </button>
        </div>

        {/* Error state */}
        {resume.status === "error" && (
          <p className="mt-2 text-center text-[11px] text-error">Processing failed. Try re-uploading.</p>
        )}
      </div>
    </div>
  );
}

export default function Resumes() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    fetchResumes();
    const channel = supabase.channel("resumes-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "resumes" }, (payload) => {
        const updated = payload.new as Resume;
        setResumes((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchResumes() {
    setLoading(true);
    const { data, error } = await supabase.from("resumes").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setResumes((data as Resume[]) ?? []);
    setLoading(false);
  }

  async function uploadResume(file: File) {
    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setUploading(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? "anonymous";
      const safeFilename = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const storagePath = `${userId}/${Date.now()}_${safeFilename}`;
      const { error: uploadErr } = await supabase.storage.from("resumes").upload(storagePath, file, { upsert: false });
      if (uploadErr) throw new Error(uploadErr.message);
      const { error: insertErr } = await supabase.from("resumes").insert({
        user_id: userId,
        original_filename: file.name,
        storage_path: storagePath,
        status: "pending_processing",
      });
      if (insertErr) throw new Error(insertErr.message);
      await fetchResumes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) uploadResume(f);
  }

  function handleDelete(id: string) {
    setResumes((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSetDefault(resume: Resume) {
    await supabase.from("resumes").update({ is_default: false }).eq("user_id", resume.user_id).eq("is_default", true);
    const { error: setErr } = await supabase.from("resumes").update({ is_default: true }).eq("id", resume.id);
    if (setErr) { setError(setErr.message); return; }
    setResumes((prev) => prev.map((r) => ({ ...r, is_default: r.id === resume.id })));
  }

  const readyCount = resumes.filter((r) => r.status === "ready").length;
  const processingCount = resumes.filter((r) => ["pending_processing", "processing"].includes(r.status)).length;
  const tailoredCount = resumes.filter((r) => !!r.parent_resume_id).length;

  const orderedResumes = [...resumes].sort((a, b) => {
    if (a.parent_resume_id === b.id) return 1;
    if (b.parent_resume_id === a.id) return -1;
    if (!!a.parent_resume_id !== !!b.parent_resume_id) return a.parent_resume_id ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      {/* Header */}
      <header className="mb-8 border-b border-ink/10 pb-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-success">DocMind</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">Resume Library</h1>
            <p className="mt-1.5 text-sm text-body">
              Your base resumes and AI-tailored versions — all in one place.
            </p>
          </div>
          {/* Upload button in header */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || !isSupabaseConfigured}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            {uploading ? "Uploading…" : "Upload Resume"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.docx" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadResume(f); }} />
        </div>

        {/* KPI Stats */}
        {resumes.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-ink/8 bg-white dark:bg-white/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-body">Total</p>
              <p className="mt-0.5 text-2xl font-bold text-ink">{resumes.length}</p>
            </div>
            <div className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-success/70">Ready</p>
              <p className="mt-0.5 text-2xl font-bold text-success">{readyCount}</p>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-primary/70">Tailored</p>
              <p className="mt-0.5 text-2xl font-bold text-primary">{tailoredCount}</p>
            </div>
            <div className={`rounded-xl border px-4 py-3 shadow-sm ${processingCount > 0 ? "border-warning/20 bg-warning/5" : "border-ink/8 bg-white dark:bg-white/5"}`}>
              <p className={`text-xs font-medium ${processingCount > 0 ? "text-warning/70" : "text-body"}`}>Processing</p>
              <p className={`mt-0.5 text-2xl font-bold ${processingCount > 0 ? "text-warning" : "text-body"}`}>
                {processingCount}
              </p>
            </div>
          </div>
        )}
      </header>

      {/* Drag-and-drop upload zone */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`mb-8 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
          dragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-ink/15 hover:border-primary/40 hover:bg-primary/[0.02]"
        }`}
      >
        <UploadCloud className={`mx-auto mb-3 transition-colors ${dragOver ? "text-primary" : "text-body"}`} size={36} />
        <p className="text-sm font-semibold text-ink">
          {dragOver ? "Drop to upload" : "Drag & drop your resume here"}
        </p>
        <p className="mt-1 text-xs text-body">PDF or DOCX · 10 MB limit · or click to browse</p>
        {uploading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-primary">
            <Loader2 size={16} className="animate-spin" /> Processing…
          </div>
        )}
      </section>

      {error && (
        <div className="mb-6 rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>
      )}

      {/* Library Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-ink/10 bg-white dark:bg-white/5 p-5 shadow-sm">
              <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-ink/8" />
              <div className="mx-auto mb-2 h-3.5 w-3/4 rounded-full bg-ink/10" />
              <div className="mx-auto mb-4 h-2.5 w-1/2 rounded-full bg-ink/6" />
              <div className="h-px w-full bg-ink/8 mb-3" />
              <div className="flex justify-center gap-2">
                <div className="h-7 w-12 rounded-lg bg-ink/6" />
                <div className="h-7 w-12 rounded-lg bg-ink/6" />
                <div className="h-7 w-12 rounded-lg bg-ink/6" />
              </div>
            </div>
          ))}
        </div>
      ) : resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink/10 bg-white dark:bg-white/5 px-6 py-24 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileText size={32} />
          </div>
          <h2 className="text-xl font-semibold text-ink">No resumes yet</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-body">
            Upload your base resume above. We'll automatically index it so it's ready for AI-powered tailoring.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {orderedResumes.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              onDelete={handleDelete}
              onSetDefault={handleSetDefault}
            />
          ))}
        </div>
      )}
    </div>
  );
}
