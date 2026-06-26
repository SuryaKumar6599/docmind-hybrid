import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  ExternalLink,
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
import { supabase, isSupabaseConfigured, type JobApplication } from "../lib/supabase";
import { motion, AnimatePresence } from "framer-motion";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};

type Citation = {
  chunk_id: string;
  document_name: string;
  quote?: string;
  application_id?: string | null;
};

type IndexedDoc = {
  name: string;
  chunks: number;
  tokens: number;
  time: string;
  category: string;
  status: "pending_processing" | "processing" | "ready" | "error";
  id: string;
};

import { useBackendStatus } from "../lib/useBackendStatus";
import { BackendStatusBadge } from "../components/BackendStatusDot";
import { BackendDebugPanel } from "../components/BackendDebugPanel";

// removed static API_URL

const SEARCH_CATEGORIES = [
  { value: "general", label: "General" },
  { value: "resume", label: "Resumes" },
  { value: "job_description", label: "Job Descriptions" },
  { value: "interview", label: "Interview Notes" },
  { value: "portfolio", label: "Portfolio" },
] as const;

function categoryLabel(value: string) {
  return SEARCH_CATEGORIES.find((cat) => cat.value === value)?.label ?? value;
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { apiUrl: API_URL, status: backendStatus } = useBackendStatus();
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
  const [uploadCategory, setUploadCategory] = useState("general");
  const [searchCategory, setSearchCategory] = useState("general");
  const [linkedApplication, setLinkedApplication] = useState<JobApplication | null>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const category = params.get("category");
    const query = params.get("q");
    const appId = params.get("application_id");
    if (category) {
      setSearchCategory(category);
      setUploadCategory(category);
    }
    if (query) setQuestion(query);
    if (appId && isSupabaseConfigured) {
      supabase
        .from("job_applications")
        .select("*")
        .eq("id", appId)
        .maybeSingle()
        .then(({ data }) => setLinkedApplication((data as JobApplication | null) ?? null));
    }
  }, []);

  useEffect(() => {
    // Listen for status updates on documents we are tracking
    const channel = supabase
      .channel("search-documents-updates")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "documents" },
        (payload) => {
          const docId = payload.new.id;
          const newStatus = payload.new.status;
          
          setIndexedDocs((prev) => {
            const exists = prev.some(d => d.id === docId);
            if (!exists) return prev;
            
            if (newStatus === "ready") {
              setStatus({ text: `Indexed "${payload.new.name}"`, type: "ok" });
            } else if (newStatus === "error") {
              setStatus({ text: `Failed to index "${payload.new.name}"`, type: "error" });
            }
            
            const chunks = payload.new.chunk_count || 0;
            const tokens = Math.round(chunks * 200);

            return prev.map(d => 
              d.id === docId ? { ...d, status: newStatus, chunks: chunks || d.chunks, tokens: tokens || d.tokens } : d
            );
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function uploadDocument() {
    if (!file) return;
    setIsUploading(true);
    setStatus({ text: "Uploading to storage…", type: "working" });
    try {
      const docId = crypto.randomUUID();
      // Remove spaces from filename for storage
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const storagePath = `public/${docId}-${safeName}`;
      
      const { error: uploadError } = await supabase.storage
        .from("search-documents")
        .upload(storagePath, file);
        
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("documents").insert({
        id: docId,
        name: file.name,
        category: uploadCategory,
        storage_path: storagePath,
        status: "pending_processing",
      });
      
      if (dbError) throw dbError;

      setIndexedDocs((prev) => [
        { 
          id: docId,
          name: file.name, 
          chunks: 0, 
          tokens: 0, 
          time: new Date().toLocaleTimeString(),
          category: uploadCategory,
          status: "pending_processing"
        },
        ...prev,
      ]);
      setStatus({ text: `Queued "${file.name}" in ${categoryLabel(uploadCategory)}`, type: "ok" });
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
        body: JSON.stringify({ question: trimmed, match_count: 5, category: searchCategory || null }),
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.body) throw new Error("No response body");

      setMessages((cur) => [
        ...cur,
        { role: "assistant", content: "", citations: [] },
      ]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === "token") {
              answer += data.text;
              setMessages((cur) => {
                const newMsgs = [...cur];
                newMsgs[newMsgs.length - 1] = { ...newMsgs[newMsgs.length - 1], content: answer };
                return newMsgs;
              });
              // Keep scrolling down as it streams
              chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
            } else if (data.type === "citations") {
              setMessages((cur) => {
                const newMsgs = [...cur];
                newMsgs[newMsgs.length - 1] = { ...newMsgs[newMsgs.length - 1], citations: data.data };
                return newMsgs;
              });
              chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }
          } catch (e) {
            console.error("Error parsing JSON line:", line, e);
          }
        }
      }
      setStatus({ text: "Ready", type: "idle" });
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
        <motion.aside 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="space-y-4"
        >
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
              <BackendStatusBadge status={backendStatus} apiUrl={API_URL} />
            </div>
            {backendStatus !== "connected" && (
              <p className="mt-2 text-xs text-ink/50">
                {backendStatus === "starting"
                  ? "Checking connection…"
                  : API_URL
                    ? "Unreachable — start FastAPI + Cloudflare Tunnel, then refresh."
                    : "Set VITE_DOCMIND_API_URL."}
              </p>
            )}
          </section>

          <BackendDebugPanel apiUrl={API_URL} />

          {linkedApplication && (
            <section className="rounded-lg border border-moss/20 bg-moss/5 p-4 text-sm text-moss shadow-sm">
              <p className="font-semibold">Search opened from Tracker</p>
              <p className="mt-1 text-xs text-moss/80">{linkedApplication.role} @ {linkedApplication.company_name}</p>
            </section>
          )}

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

            <label className="mt-3 block text-xs font-medium text-ink/50">Document bucket</label>
            <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/15 bg-paper px-2.5 py-2 text-sm text-ink">
              {SEARCH_CATEGORIES.map((cat) => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
            </select>

            <button type="button" onClick={uploadDocument}
              disabled={!file || isUploading}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-signal px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/25">
              {isUploading ? <Loader2 className="animate-spin" size={17} /> : <UploadCloud size={17} />}
              {isUploading ? "Uploading…" : "Index Document"}
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
                    <div className="flex items-center justify-between">
                      <p className="truncate text-xs font-medium text-ink">{doc.name}</p>
                      {doc.status === "pending_processing" && <span className="text-[10px] font-medium text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Queued</span>}
                      {doc.status === "processing" && <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Processing</span>}
                      {doc.status === "ready" && <span className="text-[10px] font-medium text-fern bg-fern/10 px-1.5 py-0.5 rounded">Ready</span>}
                      {doc.status === "error" && <span className="text-[10px] font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded">Error</span>}
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-ink/40">
                      <span>{categoryLabel(doc.category)}</span>
                      <span className="ml-auto">{doc.time}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </motion.aside>

        {/* ── Chat ── */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          className="flex min-h-[calc(100vh-3rem)] flex-col rounded-xl border border-ink/10 bg-white/60 backdrop-blur-xl shadow-sm shadow-ink/5"
        >
          <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4 bg-white/40">
            <div className="flex items-center gap-2 text-sm font-semibold text-moss">
              <Search size={18} /> Search
            </div>
            <div className="ml-auto mr-3 flex items-center gap-2 text-xs text-ink/50">
              <span>Scope</span>
              <select value={searchCategory} onChange={(e) => setSearchCategory(e.target.value)}
                className="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink">
                {SEARCH_CATEGORIES.map((cat) => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
              </select>
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
                placeholder={`Ask within ${categoryLabel(searchCategory).toLowerCase()}…`}
                className="min-h-11 flex-1 rounded-md border border-ink/15 bg-paper px-3 text-base outline-none ring-signal/30 focus:ring-4"
              />
              <button type="submit" disabled={!question.trim() || isAsking || backendStatus !== "connected"}
                className="flex h-11 items-center gap-2 rounded-md bg-moss px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/25">
                {isAsking ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />}
                Ask
              </button>
            </div>
            <p className="mt-1.5 text-right text-xs text-ink/25">Press Enter to send · scoped to {categoryLabel(searchCategory)}</p>
          </form>
        </motion.section>
      </div>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  return (
    <motion.article 
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && <Bot className="mt-2 shrink-0 text-moss" size={22} />}
      <div className={`max-w-3xl rounded-xl px-5 py-3.5 shadow-sm ${isUser ? "bg-signal text-white" : "bg-white border border-ink/5 text-ink"}`}>
        <p className="whitespace-pre-wrap leading-7">{message.content}</p>
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-1.5">
              {message.citations.map((c, i) => (
                <button
                  key={c.chunk_id}
                  onClick={() => setOpenCitation((cur) => (cur === c.chunk_id ? null : c.chunk_id))}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    openCitation === c.chunk_id ? "border-moss bg-moss/10 text-moss" : "border-ink/10 bg-paper text-ink/60 hover:border-moss/30 hover:text-moss"
                  }`}
                >
                  [{i + 1}] {c.document_name}
                </button>
              ))}
            </div>
            {message.citations.map((c) => (
              openCitation === c.chunk_id && (c.quote || c.application_id) && (
                <div key={c.chunk_id} className="mt-2 rounded-md border border-ink/10 bg-paper p-3 text-sm text-ink/75">
                  {c.quote && <p>{c.quote}</p>}
                  {c.application_id && (
                    <a
                      href={`/tracker?application_id=${c.application_id}`}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-moss hover:underline"
                    >
                      <ExternalLink size={12} /> Open linked application in Tracker
                    </a>
                  )}
                </div>
              )
            ))}
          </div>
        )}
      </div>
      {isUser && <User className="mt-2 shrink-0 text-signal" size={22} />}
    </motion.article>
  );
}
