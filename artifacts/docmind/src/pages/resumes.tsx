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
  parentResume,
}: {
  resume: Resume;
  onDelete: (id: string) => void;
  onSetDefault: (resume: Resume) => void;
  childCount: number;
  parentResume?: Resume;
}) {
  const cfg = STATUS_CONFIG[resume.status];
  const Icon = cfg.icon;
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

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
    <li className={`rounded-lg border border-ink/10 bg-white/80 shadow-sm ${resume.parent_resume_id ? "ml-6 border-moss/20" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <FileText className="shrink-0 text-ink/40" size={20} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {resume.original_filename}
            {resume.is_default && (
              <span className="ml-2 rounded-full bg-amber/15 px-2 py-0.5 text-[10px] font-semibold text-amber align-middle">Default</span>
            )}
            {resume.parent_resume_id && (
              <span className="ml-2 rounded-full bg-moss/10 px-2 py-0.5 text-[10px] font-semibold text-moss align-middle">Tailored</span>
            )}
            {childCount > 0 && (
              <span className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-ink/50 align-middle">{childCount} version{childCount === 1 ? "" : "s"}</span>
            )}
          </p>
          <p className="text-xs text-ink/50">
            {new Date(resume.created_at).toLocaleDateString()}
            {resume.chunk_count != null && ` · ${resume.chunk_count} chunks`}
            {wordCount != null && ` · ${wordCount.toLocaleString()} words`}
          </p>
        </div>

        {/* Status badge */}
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.color} ${cfg.bg}`}>
          <Icon size={12} className={resume.status === "processing" ? "animate-spin" : undefined} />
          {cfg.label}
        </div>

        {/* Use as default (ready only) */}
        {resume.status === "ready" && (
          <button onClick={handleSetDefault} disabled={resume.is_default || settingDefault}
            className={`rounded-md p-1.5 transition-colors ${
              resume.is_default ? "text-amber" : "text-ink/20 hover:bg-amber/10 hover:text-amber"
            }`}
            title={resume.is_default ? "Default resume" : "Use as default resume"}>
            {settingDefault ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} className={resume.is_default ? "fill-amber" : undefined} />}
          </button>
        )}

        {/* Expand markdown button (ready only) */}
        {resume.status === "ready" && resume.markdown_content && (
          <button onClick={() => setExpanded((v) => !v)}
            className="rounded-md p-1.5 text-ink/30 hover:bg-ink/5 hover:text-ink transition-colors"
            title="View extracted Markdown">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}

        {/* Delete */}
        <button onClick={handleDelete} disabled={deleting}
          className="rounded-md p-1.5 text-ink/20 hover:bg-red-50 hover:text-red-500 transition-colors"
          title="Delete resume">
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>

      {/* Markdown preview */}
      {expanded && resume.markdown_content && (
        <div className="border-t border-ink/10">
          <div className="flex items-center justify-between border-b border-ink/5 bg-paper px-4 py-2">
            <div className="flex items-center gap-3 text-xs text-ink/40">
              <span className="flex items-center gap-1"><Hash size={10} /> {resume.markdown_content.length.toLocaleString()} chars</span>
              <span>~{Math.round(resume.markdown_content.length / 4).toLocaleString()} tokens</span>
            </div>
            <div className="flex gap-2">
              {parentResume?.markdown_content && (
                <button onClick={() => setCompareOpen((value) => !value)}
                  className="flex items-center gap-1.5 rounded-md border border-moss/20 px-2.5 py-1 text-xs text-moss hover:bg-moss/5 transition-colors">
                  <FileText size={11} /> {compareOpen ? "Hide compare" : "Compare base"}
                </button>
              )}
              <button onClick={copyMarkdown}
                className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink transition-colors">
                {copied ? <CopyCheck size={11} className="text-fern" /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy Markdown"}
              </button>
              <button onClick={() => downloadText("markdown")}
                className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink transition-colors">
                <Download size={11} /> .md
              </button>
              <button onClick={() => downloadText("xml")}
                className="flex items-center gap-1.5 rounded-md border border-moss/20 px-2.5 py-1 text-xs text-moss hover:bg-moss/5 transition-colors">
                <Download size={11} /> .xml
              </button>
            </div>
          </div>
          {compareOpen && parentResume?.markdown_content && (
            <div className="grid gap-3 border-b border-ink/10 p-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-ink/45">Base: {parentResume.original_filename}</p>
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 font-mono text-xs leading-relaxed text-ink/65">
                  {parentResume.markdown_content}
                </pre>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-moss">Tailored: {resume.original_filename}</p>
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 font-mono text-xs leading-relaxed text-ink/75">
                  {resume.markdown_content}
                </pre>
              </div>
            </div>
          )}
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-ink/70">
            {resume.markdown_content}
          </pre>
        </div>
      )}

      {/* Error message */}
      {resume.status === "error" && resume.error_message && (
        <div className="flex items-start gap-2 border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Parsing failed</p>
            <p className="mt-0.5 text-red-600/80">{resume.error_message}</p>
            <p className="mt-1 text-red-500/70">Try deleting and re-uploading, or check the file isn't corrupted/password-protected.</p>
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
      const storagePath = `${userId}/${Date.now()}_${file.name}`;
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
  const resumeById = resumes.reduce<Record<string, Resume>>((acc, resume) => {
    acc[resume.id] = resume;
    return acc;
  }, {});
  const orderedResumes = [...resumes].sort((a, b) => {
    if (a.parent_resume_id === b.id) return 1;
    if (b.parent_resume_id === a.id) return -1;
    if (!!a.parent_resume_id !== !!b.parent_resume_id) return a.parent_resume_id ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 border-b border-ink/10 pb-5">
        <p className="text-sm font-semibold text-moss">DocMind</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">My Resumes</h1>
        <p className="mt-1 text-sm text-ink/60">
          Upload your base resume (PDF or DOCX). The local worker indexes it for tailoring.
        </p>
      </header>

      {!isSupabaseConfigured && (
        <div className="mb-6 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-ink/70">
          <strong>Supabase not configured.</strong> Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </div>
      )}

      {/* Stats row */}
      {resumes.length > 0 && (
        <div className="mb-6 flex gap-4">
          <div className="rounded-lg border border-ink/10 bg-white/80 px-4 py-2.5 text-center">
            <p className="text-lg font-bold text-fern">{readyCount}</p>
            <p className="text-xs text-ink/50">Ready</p>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/80 px-4 py-2.5 text-center">
            <p className="text-lg font-bold text-ink/60">{resumes.length}</p>
            <p className="text-xs text-ink/50">Total</p>
          </div>
          {processingCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/5 px-4 py-2.5 text-sm text-amber">
              <Loader2 size={14} className="animate-spin" />
              {processingCount} processing…
            </div>
          )}
        </div>
      )}

      {/* Upload area (drag & drop) */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`mb-8 cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-moss bg-moss/5" : "border-ink/15 bg-white/60 hover:border-ink/30"
        }`}
      >
        <UploadCloud className={`mx-auto mb-3 transition-colors ${dragOver ? "text-moss" : "text-ink/30"}`} size={40} />
        <p className="mb-1 text-sm font-medium text-ink/60">
          {dragOver ? "Drop to upload" : "Drag & drop or click to upload"}
        </p>
        <p className="text-xs text-ink/35">PDF or DOCX · max 10 MB</p>
        <input ref={fileRef} type="file" accept=".pdf,.docx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadResume(f); }} />
        {uploading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-signal">
            <Loader2 size={16} className="animate-spin" /> Uploading…
          </div>
        )}
      </section>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Resume list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-ink/40">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : resumes.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-center text-ink/40">
          <div>
            <FileText className="mx-auto mb-2" size={32} />
            <p>No resumes yet. Upload one to get started.</p>
          </div>
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
              parentResume={resume.parent_resume_id ? resumeById[resume.parent_resume_id] : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
