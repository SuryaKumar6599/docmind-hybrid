import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Copy,
  CopyCheck,
  Download,
  FileCode2,
  FileUp,
  Hash,
  Loader2,
  RotateCcw,
  Server,
  Type,
  Zap,
} from "lucide-react";

import { useBackendStatus } from "../lib/useBackendStatus";
import { BackendStatusDot } from "../components/BackendStatusDot";

// removed static API_URL

const SUPPORTED_FORMATS = [
  { ext: "PDF", color: "bg-red-100 text-red-700" },
  { ext: "DOCX", color: "bg-signal/10 text-signal" },
  { ext: "PPTX", color: "bg-orange-100 text-orange-700" },
  { ext: "XLSX", color: "bg-green-100 text-green-700" },
  { ext: "HTML", color: "bg-amber/10 text-amber" },
  { ext: "TXT", color: "bg-ink/5 text-ink/60" },
  { ext: "CSV", color: "bg-moss/10 text-moss" },
  { ext: "JSON", color: "bg-fern/10 text-fern" },
  { ext: "PNG/JPG", color: "bg-purple-100 text-purple-700" },
];

interface ConvertResult {
  filename: string;
  markdown: string;
  xml: string;
  char_count: number;
  word_count: number;
  estimated_tokens: number;
  ocr_used: boolean;
}

interface HistoryEntry {
  id: string;
  convertedAt: Date;
  result: ConvertResult;
}

function fileTypeBadge(filename: string): { ext: string; color: string } {
  const ext = (filename.split(".").pop() || "").toUpperCase();
  const match = SUPPORTED_FORMATS.find((f) => f.ext === ext || f.ext.startsWith(ext));
  return match ?? { ext: ext || "FILE", color: "bg-ink/5 text-ink/60" };
}

export default function Convert() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { apiUrl: API_URL, status: backendStatus } = useBackendStatus();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ocrMode, setOcrMode] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewFormat, setViewFormat] = useState<"markdown" | "xml">("markdown");

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setResult(null); setError(null); }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setResult(null); setError(null); }
  }

  async function convert() {
    if (!file || !API_URL) return;
    setLoading(true); setOcrMode(false); setError(null); setResult(null); setViewFormat("markdown");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/convert`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const data = await res.json();
      setOcrMode(data.ocr_used ?? false);
      setResult(data);
      setHistory((prev) => [{ id: `${Date.now()}-${data.filename}`, convertedAt: new Date(), result: data }, ...prev].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setLoading(false);
    }
  }

  function copyActive() {
    if (!result) return;
    const text = viewFormat === "markdown" ? result.markdown : result.xml;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function downloadFormat(format: "markdown" | "xml") {
    if (!result) return;
    const isMd = format === "markdown";
    const blob = new Blob([isMd ? result.markdown : result.xml], { type: isMd ? "text/markdown" : "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename.replace(/\.[^.]+$/, "") + (isMd ? ".md" : ".xml");
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setFile(null); setResult(null); setError(null); setOcrMode(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const tokenColor =
    !result ? ""
    : result.estimated_tokens < 4000 ? "text-fern"
    : result.estimated_tokens < 8000 ? "text-amber"
    : "text-red-500";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <header className="mb-6 border-b border-ink/10 pb-5">
        <p className="text-sm font-semibold text-moss">DocMind</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Markdown &amp; XML Generator</h1>
        <p className="mt-1 text-sm text-ink/60">
          Convert any document to clean Markdown using Microsoft MarkItDown — optimised for LLM input prompts. An XML version of the same extracted content is generated alongside it.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left sidebar */}
        <div className="space-y-4">
          {/* Backend status */}
          <div className="flex items-center justify-between rounded-lg border border-ink/10 bg-white/80 px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Server size={16} /> Local backend
            </div>
            <BackendStatusDot status={backendStatus} apiUrl={API_URL} />
          </div>

          {/* Supported formats */}
          <div className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-ink">Supported formats</p>
            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_FORMATS.map(({ ext, color }) => (
                <span key={ext} className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{ext}</span>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink/40">
              Images are processed via vision OCR (qwen2.5vl:7b)
            </p>
          </div>

          {/* Token guide */}
          <div className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">Token budget guide</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-fern" />
                <span className="text-ink/60">&lt; 4k tokens — fits comfortably</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber" />
                <span className="text-ink/60">4k–8k tokens — may need compression</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-ink/60">&gt; 8k tokens — exceeds Qwen2.5:7b window</span>
              </div>
            </div>
          </div>

          {/* Conversion history (this session) */}
          {history.length > 0 && (
            <div className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
              <p className="mb-2 text-sm font-semibold text-ink">Recent conversions</p>
              <p className="mb-3 text-xs text-ink/35">This session only — clears on reload.</p>
              <ul className="space-y-1.5">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      onClick={() => { setResult(h.result); setOcrMode(h.result.ocr_used); setError(null); setViewFormat("markdown"); }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        result === h.result ? "bg-moss/10 text-moss" : "text-ink/60 hover:bg-ink/5"
                      }`}
                    >
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${fileTypeBadge(h.result.filename).color}`}>
                        {fileTypeBadge(h.result.filename).ext}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{h.result.filename}</span>
                      <span className="shrink-0 text-ink/30">{h.convertedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* How to use */}
          <div className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">MarkItDown Features</p>
            <ul className="space-y-1.5 text-xs text-ink/60 list-disc list-inside">
              <li>Converts Office docs & PDF to clean Markdown</li>
              <li>Extracts EXIF metadata from media</li>
              <li>Runs Vision OCR on images</li>
              <li>Transcribes audio files</li>
              <li>Parses tabular data (CSV/JSON/XML)</li>
              <li>Iterates recursively through ZIP archives</li>
            </ul>
          </div>
        </div>

        {/* Main content */}
        <div className="space-y-4">
          {/* Upload area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !file && fileRef.current?.click()}
            className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-moss bg-moss/5" : file ? "border-moss/40 bg-moss/3 cursor-default" : "border-ink/15 bg-white/60 hover:border-ink/30"
            }`}
          >
            <input ref={fileRef} type="file" className="hidden" onChange={handleFile}
              accept=".pdf,.docx,.pptx,.xlsx,.html,.txt,.md,.csv,.json,.xml,.png,.jpg,.jpeg,.gif,.bmp,.tiff,.webp" />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileCode2 size={28} className="text-moss" />
                <div className="text-left">
                  <p className="font-medium text-ink">{file.name}</p>
                  <p className="text-xs text-ink/50">{(file.size / 1024).toFixed(1)} KB · ready to convert</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); reset(); }}
                  className="ml-auto rounded-md p-1.5 text-ink/30 hover:bg-ink/5 hover:text-ink">
                  <RotateCcw size={14} />
                </button>
              </div>
            ) : (
              <>
                <FileUp size={36} className="mx-auto mb-3 text-ink/25" />
                <p className="text-sm font-medium text-ink/60">Drop a file here, or click to browse</p>
                <p className="mt-1 text-xs text-ink/35">PDF, DOCX, PPTX, XLSX, HTML, TXT, images…</p>
              </>
            )}
          </div>

          {/* Convert button */}
          <button
            onClick={convert}
            disabled={!file || loading || backendStatus !== "connected"}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-moss py-3 text-sm font-semibold text-white disabled:bg-ink/25 hover:bg-moss/90 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <FileCode2 size={16} />}
            {loading
              ? ocrMode
                ? "Running Vision OCR… (up to 60s for scanned PDFs)"
                : "Converting with MarkItDown…"
              : "Convert to Markdown"}
          </button>

          {backendStatus !== "connected" && (
            <p className="rounded-md bg-amber/10 px-4 py-2.5 text-sm text-amber">
              {backendStatus === "starting"
                ? "Checking connection to local backend…"
                : API_URL
                  ? "Local backend unreachable — start FastAPI + Cloudflare Tunnel, then refresh."
                  : <>Set <code className="font-mono text-xs">VITE_DOCMIND_API_URL</code> to your Cloudflare tunnel URL to enable conversion.</>}
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="rounded-xl border border-ink/10 bg-white shadow-sm overflow-hidden">
              {/* Stats bar */}
              <div className="flex flex-wrap items-center gap-4 border-b border-ink/10 bg-paper px-4 py-3">
                <div className="flex items-center gap-1.5 text-sm">
                  <CheckCircle2 size={14} className="text-fern" />
                  <span className="font-medium text-ink">{result.filename}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${fileTypeBadge(result.filename).color}`}>
                    {fileTypeBadge(result.filename).ext}
                  </span>
                  {result.ocr_used && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Vision OCR</span>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1 text-ink/50">
                    <Hash size={11} /> {result.char_count.toLocaleString()} chars
                  </span>
                  <span className="flex items-center gap-1 text-ink/50">
                    <Type size={11} /> {result.word_count.toLocaleString()} words
                  </span>
                  <span className={`flex items-center gap-1 font-semibold ${tokenColor}`}>
                    <Zap size={11} /> ~{result.estimated_tokens.toLocaleString()} tokens
                  </span>
                </div>
              </div>

              {/* Format toggle + actions */}
              <div className="flex flex-wrap items-center gap-3 border-b border-ink/10 bg-paper/50 px-4 py-2.5">
                <div className="flex rounded-md border border-ink/15 bg-white p-0.5 text-xs font-medium">
                  <button onClick={() => setViewFormat("markdown")}
                    className={`flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
                      viewFormat === "markdown" ? "bg-moss text-white" : "text-ink/50 hover:text-ink"
                    }`}>
                    <FileCode2 size={12} /> Markdown
                  </button>
                  <button onClick={() => setViewFormat("xml")}
                    className={`flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
                      viewFormat === "xml" ? "bg-moss text-white" : "text-ink/50 hover:text-ink"
                    }`}>
                    <Code2 size={12} /> XML
                  </button>
                </div>

                <div className="ml-auto flex gap-2">
                  <button onClick={copyActive}
                    className="flex items-center gap-1.5 rounded-md border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5 transition-colors">
                    {copied ? <CopyCheck size={12} className="text-fern" /> : <Copy size={12} />}
                    {copied ? "Copied!" : `Copy ${viewFormat === "markdown" ? "Markdown" : "XML"}`}
                  </button>
                  <button onClick={() => downloadFormat("markdown")}
                    className="flex items-center gap-1.5 rounded-md border border-moss/30 px-3 py-1.5 text-xs font-medium text-moss hover:bg-moss/5 transition-colors">
                    <Download size={12} /> .md
                  </button>
                  <button onClick={() => downloadFormat("xml")}
                    className="flex items-center gap-1.5 rounded-md bg-moss px-3 py-1.5 text-xs font-medium text-white hover:bg-moss/90 transition-colors">
                    <Download size={12} /> .xml
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div className="max-h-[560px] overflow-y-auto">
                <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-ink/80">
                  {viewFormat === "markdown" ? result.markdown : result.xml}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
