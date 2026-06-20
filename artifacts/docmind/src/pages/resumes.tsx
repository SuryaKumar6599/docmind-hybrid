import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { supabase, isSupabaseConfigured, type Resume, type ResumeStatus } from "../lib/supabase";

const STATUS_CONFIG: Record<
  ResumeStatus,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  pending_processing: {
    label: "Queued",
    color: "text-amber",
    icon: Clock,
  },
  processing: {
    label: "Processing",
    color: "text-signal",
    icon: Loader2,
  },
  ready: {
    label: "Ready",
    color: "text-fern",
    icon: CheckCircle2,
  },
  error: {
    label: "Error",
    color: "text-red-500",
    icon: XCircle,
  },
};

export default function Resumes() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    fetchResumes();

    // Realtime subscription
    const channel = supabase
      .channel("resumes-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "resumes" },
        (payload) => {
          const updated = payload.new as Resume;
          setResumes((prev) =>
            prev.map((r) => (r.id === updated.id ? updated : r))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchResumes() {
    setLoading(true);
    const { data, error } = await supabase
      .from("resumes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setResumes((data as Resume[]) ?? []);
    setLoading(false);
  }

  async function uploadResume(file: File) {
    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? "anonymous";
      const storagePath = `${userId}/${Date.now()}_${file.name}`;

      // 1. Upload file to Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from("resumes")
        .upload(storagePath, file, { upsert: false });
      if (uploadErr) throw new Error(uploadErr.message);

      // 2. Insert DB row — worker picks this up and sets status=ready
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 border-b border-ink/10 pb-5">
        <p className="text-sm font-semibold text-moss">DocMind</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">My Resumes</h1>
        <p className="mt-1 text-sm text-ink/60">
          Upload your base resume (PDF or DOCX). The local worker processes it
          and indexes it for tailoring.
        </p>
      </header>

      {!isSupabaseConfigured && (
        <div className="mb-6 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-ink/70">
          <strong>Supabase not configured.</strong> Set{" "}
          <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> to enable resume management.
        </div>
      )}

      {/* Upload area */}
      <section className="mb-8 rounded-lg border-2 border-dashed border-ink/15 bg-white/60 p-8 text-center">
        <UploadCloud className="mx-auto mb-3 text-ink/30" size={40} />
        <p className="mb-4 text-sm text-ink/60">
          Drop a PDF or DOCX here, or click to browse
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadResume(f);
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !isSupabaseConfigured}
          className="inline-flex items-center gap-2 rounded-md bg-signal px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/25"
        >
          {uploading ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <UploadCloud size={16} />
          )}
          {uploading ? "Uploading..." : "Upload Resume"}
        </button>
      </section>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
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
          {resumes.map((resume) => {
            const cfg = STATUS_CONFIG[resume.status];
            const Icon = cfg.icon;
            return (
              <li
                key={resume.id}
                className="flex items-center justify-between rounded-lg border border-ink/10 bg-white/80 px-4 py-3 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <FileText className="shrink-0 text-ink/40" size={20} />
                  <div>
                    <p className="font-medium text-ink">
                      {resume.original_filename}
                    </p>
                    <p className="text-xs text-ink/50">
                      {new Date(resume.created_at).toLocaleDateString()}
                      {resume.chunk_count != null &&
                        ` · ${resume.chunk_count} chunks`}
                    </p>
                  </div>
                </div>
                <div
                  className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.color}`}
                >
                  <Icon
                    size={14}
                    className={
                      resume.status === "processing"
                        ? "animate-spin"
                        : undefined
                    }
                  />
                  {cfg.label}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
