import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  CopyCheck,
  Download,
  FileText,
  Hash,
  Loader2,
  Star,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { supabase, isSupabaseConfigured, type Resume, type ResumeStatus } from "../lib/supabase";
import { markdownToXml } from "../lib/markdownToXml";

const STATUS_CONFIG: Record<ResumeStatus, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  pending_processing: { label: "Queued",     color: "text-amber",   bg: "bg-amber/10",  icon: Clock },
  processing:         { label: "Processing", color: "text-signal",  bg: "bg-signal/10", icon: Loader2 },
  ready:              { label: "Ready",      color: "text-fern",    bg: "bg-fern/10",   icon: CheckCircle2 },
  error:              { label: "Error",      color: "text-red-500", bg: "bg-red-50",    icon: XCircle },
};

function ResumeRow({
  resume,
  onDelete,
  onSetDefault,
  childCount,
}: {
  resume: Resume;
  onDelete: (id: string) => void;
  onSetDefault: (resume: Resume) => void;
  childCount: number;
}) {
  const cfg = STATUS_CONFIG[resume.status];
  const Icon = cfg.icon;
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [copied, setCopied] = useState(false);

  const wordCount = resume.markdown_content
    ? resume.markdown_content.trim().split(/\s+/).filter(Boolean).length
    : null;

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
    try {
      await onSetDefault(resume);
    } finally {
      setSettingDefault(false);
    }
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
    <li className={`rounded-xl border bg-white dark:bg-white/5 shadow-sm transition-shadow duration-150 ${resume.is_default ? "border-moss/40 ring-2 ring-moss/15 shadow-moss/5" : "border-ink/10 hover:shadow-md hover:border-ink/20"}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        
        {/* Left Side: Click to expand */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-3 text-left min-w-0"
        >
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.bg} transition-colors`}>
            <Icon className={cfg.color} size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink leading-tight flex items-center gap-2">
              {resume.original_filename}
              {resume.parent_resume_id && (
                <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-ink/40">Tailored</span>
              )}
            </p>
            <p className="truncate text-xs text-ink/50 mt-0.5">
              {new Date(resume.created_at).toLocaleDateString(undefined, {
                year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
              })}
              {wordCount != null && <span className="ml-2">· {wordCount} words</span>}
              {childCount > 0 && <span className="ml-2 font-medium text-ink/60">· {childCount} derived</span>}
            </p>
          </div>
        </button>

        {/* Right Side: Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {!resume.parent_resume_id && resume.status === "ready" && (
            <button
              onClick={handleSetDefault}
              disabled={settingDefault || resume.is_default}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
                resume.is_default ? "bg-moss text-white shadow-sm" : "bg-ink/5 text-ink/50 hover:bg-ink/10 hover:text-ink/80"
              }`}
              title="Default resume for Quick Skills Check"
            >
              <Star size={12} className={resume.is_default ? "fill-white" : ""} />
              {resume.is_default ? "Default" : "Set Default"}
            </button>
          )}

          <button onClick={() => setExpanded((v) => !v)} className="flex h-7 w-7 items-center justify-center rounded-md text-ink/30 transition-colors hover:bg-ink/5 hover:text-ink/60">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-ink/10 px-5 pb-5 pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => downloadText("markdown")}
                disabled={!resume.markdown_content}
                className="flex items-center gap-1.5 rounded-lg border border-ink/12 px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-50"
              >
                <Download size={14} /> Download Markdown
              </button>
              <button
                onClick={() => downloadText("xml")}
                disabled={!resume.markdown_content}
                className="flex items-center gap-1.5 rounded-lg border border-ink/12 px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-50"
              >
                <Download size={14} /> Download XML
              </button>
              <button
                onClick={copyMarkdown}
                disabled={!resume.markdown_content}
                className="flex items-center gap-1.5 rounded-lg border border-ink/12 px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors disabled:opacity-50"
              >
                {copied ? <CopyCheck size={14} className="text-fern" /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} /> {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-ink/10 bg-paper p-4 text-xs font-mono text-ink/70 max-h-64 overflow-y-auto shadow-inner">
              {resume.status === "error" ? (
                <span className="text-red-500">Processing failed. Please try again.</span>
              ) : resume.markdown_content ? (
                <pre className="whitespace-pre-wrap">{resume.markdown_content.slice(0, 500)}...</pre>
              ) : (
                <span className="italic">Indexing in progress... (this usually takes 10-20 seconds)</span>
              )}
            </div>
        </div>
      )}
    </li>
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
    // Partial unique index allows only one is_default=true per user, so unset first.
    await supabase.from("resumes").update({ is_default: false }).eq("user_id", resume.user_id).eq("is_default", true);
    const { error: setErr } = await supabase.from("resumes").update({ is_default: true }).eq("id", resume.id);
    if (setErr) {
      setError(setErr.message);
      return;
    }
    setResumes((prev) => prev.map((r) => ({ ...r, is_default: r.id === resume.id })));
  }

  const readyCount = resumes.filter((r) => r.status === "ready").length;
  const processingCount = resumes.filter((r) => ["pending_processing", "processing"].includes(r.status)).length;
  const childCounts = resumes.reduce<Record<string, number>>((acc, resume) => {
    if (resume.parent_resume_id) acc[resume.parent_resume_id] = (acc[resume.parent_resume_id] ?? 0) + 1;
    return acc;
  }, {});
  const orderedResumes = [...resumes].sort((a, b) => {
    if (a.parent_resume_id === b.id) return 1;
    if (b.parent_resume_id === a.id) return -1;
    if (!!a.parent_resume_id !== !!b.parent_resume_id) return a.parent_resume_id ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8 border-b border-ink/10 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-moss">DocMind</p>
        <h1 className="mt-1 text-3xl font-bold text-ink">My Library</h1>
        <p className="mt-2 text-sm text-ink/60">
          Manage your base resumes and AI-tailored versions.
        </p>

        {/* Stats bar */}
        {resumes.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-ink/8 bg-white dark:bg-white/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">Total</p>
              <p className="mt-0.5 text-2xl font-bold text-ink">{resumes.length}</p>
            </div>
            <div className="rounded-xl border border-ink/8 bg-white dark:bg-white/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">Ready</p>
              <p className="mt-0.5 text-2xl font-bold text-fern">{readyCount}</p>
            </div>
            <div className="rounded-xl border border-ink/8 bg-white dark:bg-white/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">Tailored</p>
              <p className="mt-0.5 text-2xl font-bold text-moss">{resumes.length - readyCount - processingCount > 0 ? resumes.length - readyCount - processingCount : 0}</p>
            </div>
            <div className="rounded-xl border border-ink/8 bg-white dark:bg-white/5 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-ink/50">Processing</p>
              <p className="mt-0.5 text-2xl font-bold text-amber">{processingCount}</p>
            </div>
          </div>
        )}
      </header>

      {/* Upload area (drag & drop) */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`mb-8 cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-moss bg-moss/5" : "border-ink/15 bg-white dark:bg-white/5/60 hover:border-ink/30"
        }`}
      >
        <UploadCloud className={`mx-auto mb-3 transition-colors ${dragOver ? "text-moss" : "text-ink/30"}`} size={40} />
        <p className="mb-1 text-sm font-medium text-ink/60">
          {dragOver ? "Drop to upload" : "Upload new base resume"}
        </p>
        <p className="text-xs text-ink/35">PDF or DOCX · 10 MB limit</p>
        <input ref={fileRef} type="file" accept=".pdf,.docx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadResume(f); }} />
        {uploading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-signal">
            <Loader2 size={16} className="animate-spin" /> Processing…
          </div>
        )}
      </section>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Resume list */}
      {loading ? (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="animate-pulse rounded-xl border border-ink/10 bg-white dark:bg-white/5 px-5 py-4 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="h-9 w-9 shrink-0 rounded-full bg-ink/8" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 rounded-full bg-ink/10" />
                  <div className="h-2.5 w-1/4 rounded-full bg-ink/6" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink/10 bg-white dark:bg-white/5 px-6 py-24 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss">
            <FileText size={32} />
          </div>
          <h2 className="text-xl font-semibold text-ink">No resumes yet</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink/60">
            Upload your base resume above. We'll automatically index it so it's ready for AI-powered tailoring.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orderedResumes.map((resume) => (
            <ResumeRow
              key={resume.id}
              resume={resume}
              onDelete={handleDelete}
              onSetDefault={handleSetDefault}
              childCount={childCounts[resume.id] ?? 0}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
