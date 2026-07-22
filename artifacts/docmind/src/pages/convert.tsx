import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Copy,
  CopyCheck,
  Download,
  FileCode2,
  FileText,
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
import { markdownToXml } from "../lib/markdownToXml";

const SUPPORTED_FORMATS = [
  { ext: "PDF", color: "bg-red-100 text-red-700" },
  { ext: "DOCX", color: "bg-signal/10 text-signal" },
  { ext: "PPTX", color: "bg-orange-100 text-orange-700" },
  { ext: "XLSX", color: "bg-green-100 text-green-700" },
  { ext: "HTML", color: "bg-amber/10 text-amber" },
  { ext: "TXT", color: "bg-ink/5 text-ink/60" },
  { ext: "CSV", color: "bg-fern/10 text-fern" },
  { ext: "JSON", color: "bg-signal/10 text-signal" },
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

function StepBadge({ number, label, active, done }: { number: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${active ? "opacity-100" : done ? "opacity-70" : "opacity-35"}`}>
      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
        done ? "bg-fern text-white" : active ? "bg-signal text-white" : "bg-ink/10 text-ink"
      }`}>
        {done ? <CheckCircle2 size={14} /> : number}
      </div>
      <span className={`text-sm font-semibold ${active ? "text-ink" : "text-ink/60"}`}>{label}</span>
    </div>
  );
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
  const [copiedMd, setCopiedMd] = useState(false);
  const [copiedXml, setCopiedXml] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewFormat, setViewFormat] = useState<"markdown" | "xml">("markdown");

  // Derived step state
  const step = result ? 3 : file ? 2 : 1;

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

  function normalizeConvertResult(data: any, fallbackFilename: string): ConvertResult {
    const filename = String(data?.filename || fallbackFilename || "document");
    const markdown = String(data?.markdown || "");
    const xml = typeof data?.xml === "string" && data.xml.trim()
      ? data.xml
      : markdownToXml(markdown, filename);
    return {
      filename,
      markdown,
      xml,
      char_count: Number(data?.char_count ?? markdown.length),
      word_count: Number(data?.word_count ?? markdown.trim().split(/\s+/).filter(Boolean).length),
      estimated_tokens: Number(data?.estimated_tokens ?? Math.ceil(markdown.length / 4)),
      ocr_used: Boolean(data?.ocr_used ?? false),
    };
  }

  async function convert() {
    if (!file || !API_URL) return;
    setLoading(true); setOcrMode(false); setError(null); setResult(null); setViewFormat("markdown");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/convert`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const data = normalizeConvertResult(await res.json(), file.name);
      setOcrMode(data.ocr_used);
      setResult(data);
      setHistory((prev) => [{ id: `${Date.now()}-${data.filename}`, convertedAt: new Date(), result: data }, ...prev].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setLoading(false);
    }
  }

  function copyText(format: "markdown" | "xml") {
    if (!result) return;
    const text = format === "markdown" ? result.markdown : result.xml;
    navigator.clipboard.writeText(text).then(() => {
      if (format === "markdown") {
        setCopiedMd(true);
        setTimeout(() => setCopiedMd(false), 2500);
      } else {
        setCopiedXml(true);
        setTimeout(() => setCopiedXml(false), 2500);
      }
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      {/* Header */}
      <header className="mb-8 border-b border-ink/10 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-fern">DocMind</p>
            <h1 className="mt-1 text-3xl font-bold text-ink">Document Converter</h1>
            <p className="mt-1.5 text-sm text-ink/60 max-w-lg">
              Convert any document to clean Markdown + XML using Microsoft MarkItDown — optimised for LLM input prompts.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 rounded-xl border border-ink/10 bg-white dark:bg-white/5 px-4 py-2.5 text-sm shadow-sm">
            <Server size={14} className="text-ink/60" />
            <span className="text-sm text-ink/60 font-medium">Backend</span>
            <BackendStatusDot status={backendStatus} apiUrl={API_URL} />
          </div>
        </div>

        {/* 3-Step Progress Bar */}
        <div className="mt-6 flex items-center gap-3">
          <StepBadge number={1} label="Upload" active={step === 1} done={step > 1} />
          <div className={`h-px flex-1 rounded-full transition-colors ${step > 1 ? "bg-primary/40" : "bg-ink/10"}`} />
          <StepBadge number={2} label="Convert" active={step === 2} done={step > 2} />
          <div className={`h-px flex-1 rounded-full transition-colors ${step > 2 ? "bg-primary/40" : "bg-ink/10"}`} />
          <StepBadge number={3} label="Results" active={step === 3} done={false} />
        </div>
      </header>

      {/* STEP 1: Upload */}
      {step <= 2 && (
        <div className="space-y-5">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !file && fileRef.current?.click()}
            className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
              dragOver
                ? "border-primary bg-primary/5 scale-[1.01]"
                : file
                  ? "border-fern/40 bg-success/[0.03] cursor-default"
                  : "border-ink/15 hover:border-signal/30 hover:bg-ink/[0.02]"
            }`}
          >
            <input ref={fileRef} type="file" className="hidden" onChange={handleFile}
              accept=".pdf,.docx,.pptx,.xlsx,.html,.txt,.md,.csv,.json,.xml,.png,.jpg,.jpeg,.gif,.bmp,.tiff,.webp" />

            {file ? (
              <div className="flex items-center justify-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fern/10 text-fern">
                  <FileText size={28} />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-ink">{file.name}</p>
                  <p className="mt-0.5 text-sm text-ink/60">
                    {(file.size / 1024).toFixed(1)} KB
                    <span className="ml-2 rounded-full bg-fern/10 px-2 py-0.5 text-[11px] font-semibold text-fern">Ready to convert</span>
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); reset(); }}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            ) : (
              <>
                <FileUp size={40} className="mx-auto mb-4 text-ink/60" />
                <p className="text-base font-semibold text-ink">Drop your file here</p>
                <p className="mt-1.5 text-sm text-ink/60">PDF, DOCX, PPTX, XLSX, images, and more · or click to browse</p>
                {/* Format chips */}
                <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                  {SUPPORTED_FORMATS.map(({ ext, color }) => (
                    <span key={ext} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{ext}</span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Backend warning */}
          {backendStatus !== "connected" && (
            <div className="flex items-start gap-3 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-sm text-amber">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {backendStatus === "starting"
                ? "Checking connection to local backend…"
                : API_URL
                  ? "Local backend unreachable — start FastAPI + Cloudflare Tunnel, then refresh."
                  : <><code className="font-mono text-xs">VITE_DOCMIND_API_URL</code> is not set. Add your Cloudflare tunnel URL to enable conversion.</>}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-500">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* STEP 2: Convert Action */}
          {file && (
            <div className="rounded-2xl border border-ink/10 bg-white dark:bg-white/5 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">Ready to convert</p>
                  <p className="mt-0.5 text-xs text-ink/60">
                    MarkItDown will extract text and structure it as Markdown + XML.
                    {` `}<span className="text-ink/40">Images use Vision OCR if needed.</span>
                  </p>
                </div>
                <button
                  onClick={convert}
                  disabled={!file || loading || backendStatus !== "connected"}
                  className="flex items-center gap-2 rounded-xl bg-signal px-6 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <><Loader2 size={16} className="animate-spin" />{ocrMode ? "Running Vision OCR…" : "Converting…"}</>
                  ) : (
                    <><FileCode2 size={16} /> Convert Document</>
                  )}
                </button>
              </div>
              {loading && (
                <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                  <div className="h-full animate-pulse rounded-full bg-primary/60 w-2/3 transition-all" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Results — Dual Pane */}
      {result && (
        <div className="space-y-4">
          {/* Stats bar */}
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-fern/20 bg-fern/5 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-fern" />
              <span className="font-semibold text-ink text-sm">{result.filename}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${fileTypeBadge(result.filename).color}`}>
                {fileTypeBadge(result.filename).ext}
              </span>
              {result.ocr_used && (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Vision OCR</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-4 text-xs text-ink/60">
              <span className="flex items-center gap-1"><Hash size={11} /> {result.char_count.toLocaleString()} chars</span>
              <span className="flex items-center gap-1"><Type size={11} /> {result.word_count.toLocaleString()} words</span>
              <span className={`flex items-center gap-1 font-bold ${tokenColor}`}>
                <Zap size={11} /> ~{result.estimated_tokens.toLocaleString()} tokens
              </span>
            </div>
            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors"
            >
              <RotateCcw size={12} /> New File
            </button>
          </div>

          {/* Dual Pane */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Pane: Markdown */}
            <div className="flex flex-col rounded-2xl border border-ink/10 bg-white dark:bg-white/5 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-ink/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <FileCode2 size={14} className="text-signal" />
                  <span className="text-sm font-semibold text-ink">Markdown</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyText("markdown")}
                    className="flex items-center gap-1.5 rounded-lg bg-fern/10 px-3 py-1.5 text-xs font-semibold text-fern hover:bg-fern/15 transition-colors"
                  >
                    {copiedMd ? <CopyCheck size={12} /> : <Copy size={12} />}
                    {copiedMd ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => downloadFormat("markdown")}
                    className="flex items-center gap-1.5 rounded-lg border border-ink/12 px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors"
                  >
                    <Download size={12} /> .md
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[520px] bg-[#0f172a]">
                <pre className="whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-slate-300">
                  {result.markdown}
                </pre>
              </div>
            </div>

            {/* Pane: XML */}
            <div className="flex flex-col rounded-2xl border border-ink/10 bg-white dark:bg-white/5 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-ink/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Code2 size={14} className="text-amber" />
                  <span className="text-sm font-semibold text-ink">XML</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyText("xml")}
                    className="flex items-center gap-1.5 rounded-lg bg-fern/10 px-3 py-1.5 text-xs font-semibold text-fern hover:bg-fern/15 transition-colors"
                  >
                    {copiedXml ? <CopyCheck size={12} /> : <Copy size={12} />}
                    {copiedXml ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => downloadFormat("xml")}
                    className="flex items-center gap-1.5 rounded-lg border border-ink/12 px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink transition-colors"
                  >
                    <Download size={12} /> .xml
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[520px] bg-[#0f172a]">
                <pre className="whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-slate-300">
                  {result.xml}
                </pre>
              </div>
            </div>
          </div>

          {/* Future hook: workflow integration CTA */}
          {/* HOOK: conversion_workflow_integration — on conversion complete, offer Add to Library / Use in Application */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/10 bg-white dark:bg-white/5 px-5 py-3.5 text-sm shadow-sm">
            <p className="text-ink/60 text-sm">What's next with this document?</p>
            <div className="ml-auto flex gap-2">
              <button disabled className="flex items-center gap-1.5 rounded-lg border border-ink/12 px-4 py-2 text-xs font-medium text-ink/60/50 cursor-not-allowed">
                Add to Library <span className="text-[10px] ml-1 opacity-60">(Phase 2)</span>
              </button>
              <button disabled className="flex items-center gap-1.5 rounded-lg bg-signal/10 px-4 py-2 text-xs font-semibold text-signal/50 cursor-not-allowed">
                Use in Application <span className="text-[10px] ml-1 opacity-60">(Phase 2)</span>
              </button>
            </div>
          </div>

          {/* Session history */}
          {history.length > 1 && (
            <div className="rounded-xl border border-ink/10 bg-white dark:bg-white/5 p-4 shadow-sm">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink/60">Session History</p>
              <div className="flex flex-wrap gap-2">
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => { setResult(h.result); setOcrMode(h.result.ocr_used); setError(null); setViewFormat("markdown"); }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      result === h.result ? "border-signal/30 bg-signal/10 text-signal" : "border-ink/10 text-ink/60 hover:bg-ink/5"
                    }`}
                  >
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${fileTypeBadge(h.result.filename).color}`}>
                      {fileTypeBadge(h.result.filename).ext}
                    </span>
                    <span className="max-w-[120px] truncate">{h.result.filename}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
