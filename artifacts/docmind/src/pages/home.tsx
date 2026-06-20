import { FormEvent, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  FileUp,
  Hash,
  Loader2,
  RotateCcw,
  Search,
  Server,
  Trash2,
  UploadCloud,
  User,
  Zap,
} from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};

type Citation = {
  chunk_id: string;
  document_name: string;
  quote?: string;
};

type IndexedDoc = {
  name: string;
  chunks: number;
  tokens: number;
  time: string;
};

const API_URL =
  (import.meta.env.VITE_DOCMIND_API_URL as string | undefined)?.replace(/\/+$/, "") || "";

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [indexedDocs, setIndexedDocs] = useState<IndexedDoc[]>([]);
  const [status, setStatus] = useState<{ text: string; type: "idle" | "working" | "ok" | "error" }>({
    text: "Ready", type: "idle",
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const apiReady = useMemo(() => Boolean(API_URL), []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  async function uploadDocument() {
    if (!file || !API_URL) return;
    setIsUploading(true);
    setStatus({ text: "Indexing…", type: "working" });
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_URL}/index`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const chunks = data.chunks || 0;
      const tokens = Math.round((file.size / 1024) * 0.35); // rough estimate from file size
      setIndexedDocs((prev) => [
        { name: data.document_name || file.name, chunks, tokens, time: new Date().toLocaleTimeString() },
        ...prev,
      ]);
      setStatus({ text: `Indexed "${data.document_name || file.name}" (${chunks} chunks)`, type: "ok" });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : "Upload failed", type: "error" });
    } finally {
      setIsUploading(false);
    }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !API_URL) return;
    setMessages((cur) => [...cur, { role: "user", content: trimmed }]);
    setQuestion("");
    setIsAsking(true);
    setStatus({ text: "Searching…", type: "working" });
    try {
      const response = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, match_count: 5 }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setMessages((cur) => [
        ...cur,
        { role: "assistant", content: data.answer || "I do not know.", citations: data.citations || [] },
      ]);
      setStatus({ text: "Ready", type: "idle" });
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : "Search failed", type: "error" });
    } finally {
      setIsAsking(false);
    }
  }

  const statusColor = {
    idle: "text-ink/50",
    working: "text-signal",
    ok: "text-fern",
    error: "text-red-500",
  }[status.type];

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[340px_1fr]">
        {/* ── Sidebar ── */}
        <aside className="space-y-4">
          <header className="border-b border-ink/10 pb-5">
            <p className="text-sm font-semibold text-moss">DocMind</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
              Document Search
            </h1>
          </header>

          {/* Backend status */}
          <section className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Server size={18} /> Local backend
              </div>
              <span className={`h-2.5 w-2.5 rounded-full ${apiReady ? "bg-fern" : "bg-amber"}`} />
            </div>
            <p className="mt-2 break-all text-xs text-ink/50">
              {apiReady ? API_URL : "Set VITE_DOCMIND_API_URL"}
            </p>
          </section>

          {/* Upload */}
          <section className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <FileUp size={18} /> Index document
            </label>

            {/* Drag & drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInput.current?.click()}
              className={`cursor-pointer rounded-md border-2 border-dashed px-3 py-4 text-center text-sm transition-colors ${
                dragOver ? "border-moss bg-moss/5" : "border-ink/15 hover:border-ink/30"
              }`}
            >
              {file ? (
                <div className="flex items-center gap-2 justify-center text-ink/70">
                  <UploadCloud size={15} className="text-moss" />
                  <span className="truncate max-w-[160px]">{file.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="text-ink/30 hover:text-ink">
                    <RotateCcw size={13} />
                  </button>
                </div>
              ) : (
                <span className="text-ink/40">Drop or click to choose file</span>
              )}
            </div>
            <input id="document-upload" ref={fileInput} type="file"
              accept=".pdf,.docx,.pptx,.txt,.html,.md,.csv,.json,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden" />

            <button type="button" onClick={uploadDocument}
              disabled={!file || isUploading || !apiReady}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-signal px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/25">
              {isUploading ? <Loader2 className="animate-spin" size={17} /> : <UploadCloud size={17} />}
              {isUploading ? "Indexing…" : "Index Document"}
            </button>
          </section>

          {/* Status */}
          <section className="rounded-lg border border-ink/10 bg-white/80 p-3 shadow-sm">
            <div className={`flex items-start gap-2 text-sm ${statusColor}`}>
              {status.type === "working" ? (
                <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin" />
              ) : (
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
              )}
              <p>{status.text}</p>
            </div>
          </section>

          {/* Indexed docs history */}
          {indexedDocs.length > 0 && (
            <section className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Indexed this session</p>
                <button onClick={() => setIndexedDocs([])}
                  className="text-xs text-ink/30 hover:text-ink">Clear</button>
              </div>
              <ul className="space-y-2">
                {indexedDocs.map((doc, i) => (
                  <li key={i} className="rounded-md border border-ink/8 bg-paper px-3 py-2">
                    <p className="truncate text-xs font-medium text-ink">{doc.name}</p>
                    <div className="mt-0.5 flex gap-3 text-xs text-ink/40">
                      <span className="flex items-center gap-0.5"><Hash size={9} /> {doc.chunks} chunks</span>
                      <span className="flex items-center gap-0.5"><Zap size={9} /> ~{doc.tokens.toLocaleString()} tokens</span>
                      <span className="ml-auto">{doc.time}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/* ── Chat ── */}
        <section className="flex min-h-[calc(100vh-3rem)] flex-col rounded-lg border border-ink/10 bg-white/85 shadow-sm">
          <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-moss">
              <Search size={18} /> Search
            </div>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-ink/40 hover:bg-ink/5 hover:text-ink transition-colors">
                <Trash2 size={13} /> Clear chat
              </button>
            )}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-96 flex-col items-center justify-center gap-4 text-center text-ink/40">
                <Bot size={40} className="text-ink/20" />
                <div>
                  <p className="text-lg">Ask anything about your indexed documents.</p>
                  <p className="mt-1 text-sm">
                    Index a document from the sidebar first, then ask a question.
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {["What are the key points?", "Summarise this document", "What skills are required?"].map((q) => (
                    <button key={q} onClick={() => setQuestion(q)}
                      className="rounded-full border border-ink/10 bg-paper px-3 py-1.5 text-xs hover:border-moss/40 hover:text-moss transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          <form onSubmit={ask} className="border-t border-ink/10 p-4">
            <div className="flex gap-3">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask across indexed documents…"
                className="min-h-11 flex-1 rounded-md border border-ink/15 bg-paper px-3 text-base outline-none ring-signal/30 focus:ring-4"
              />
              <button type="submit" disabled={!question.trim() || isAsking || !apiReady}
                className="flex h-11 items-center gap-2 rounded-md bg-moss px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/25">
                {isAsking ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />}
                Ask
              </button>
            </div>
            <p className="mt-1.5 text-right text-xs text-ink/25">Press Enter to send</p>
          </form>
        </section>
      </div>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <article className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <Bot className="mt-2 shrink-0 text-moss" size={22} />}
      <div className={`max-w-3xl rounded-lg px-4 py-3 ${isUser ? "bg-signal text-white" : "bg-paper text-ink"}`}>
        <p className="whitespace-pre-wrap leading-7">{message.content}</p>
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.citations.map((c) => (
              <details key={c.chunk_id} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-moss">
                  {c.document_name} — {c.chunk_id}
                </summary>
                {c.quote && <p className="mt-2 text-ink/75">{c.quote}</p>}
              </details>
            ))}
          </div>
        )}
      </div>
      {isUser && <User className="mt-2 shrink-0 text-signal" size={22} />}
    </article>
  );
}
