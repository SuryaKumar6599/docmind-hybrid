import { FormEvent, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, FileUp, Loader2, Search, Server, UploadCloud, User } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  sources?: Source[];
};

type Citation = {
  chunk_id: string;
  document_name: string;
  quote?: string;
};

type Source = {
  id: string;
  document_name?: string;
  chunk_index?: number;
  content: string;
  similarity?: number;
};

const API_URL = (import.meta.env.VITE_DOCMIND_API_URL as string | undefined)?.replace(/\/$/, "") || "";

export default function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<string>("Ready");
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const apiReady = useMemo(() => Boolean(API_URL), []);

  async function uploadDocument() {
    if (!file || !API_URL) return;
    setIsUploading(true);
    setStatus("Indexing document");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_URL}/index`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setStatus(`Indexed ${data.document_name || file.name} (${data.chunks || 0} chunks)`);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !API_URL) return;
    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setQuestion("");
    setIsAsking(true);
    setStatus("Searching");
    try {
      const response = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, match_count: 5 })
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer || "I do not know.",
          citations: data.citations || [],
          sources: data.sources || []
        }
      ]);
      setStatus("Ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <header className="border-b border-ink/10 pb-5">
            <p className="text-sm font-semibold text-moss">DocMind</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">Enterprise document search</h1>
          </header>

          <section className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Server size={18} />
                Local backend
              </div>
              <span className={`h-2.5 w-2.5 rounded-full ${apiReady ? "bg-fern" : "bg-amber"}`} />
            </div>
            <p className="mt-3 break-all text-sm text-ink/70">
              {apiReady ? API_URL : "Set VITE_DOCMIND_API_URL"}
            </p>
          </section>

          <section className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink" htmlFor="document-upload">
              <FileUp size={18} />
              Upload
            </label>
            <input
              id="document-upload"
              ref={fileInput}
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="block w-full rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-moss file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
            />
            <button
              type="button"
              onClick={uploadDocument}
              disabled={!file || isUploading || !apiReady}
              className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-signal px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/25"
            >
              {isUploading ? <Loader2 className="animate-spin" size={17} /> : <UploadCloud size={17} />}
              Index Document
            </button>
          </section>

          <section className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm">
            <div className="flex items-start gap-2 text-sm text-ink/75">
              <AlertCircle className="mt-0.5 shrink-0 text-amber" size={18} />
              <p>{status}</p>
            </div>
          </section>
        </aside>

        <section className="flex min-h-[calc(100vh-3rem)] flex-col rounded-lg border border-ink/10 bg-white/85 shadow-sm">
          <div className="border-b border-ink/10 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-moss">
              <Search size={18} />
              Search
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-96 items-center justify-center text-center text-ink/55">
                <p className="max-w-md text-lg">Ask a question after indexing documents from your local backend.</p>
              </div>
            ) : (
              messages.map((message, index) => <MessageBubble key={index} message={message} />)
            )}
          </div>

          <form onSubmit={ask} className="border-t border-ink/10 p-4">
            <div className="flex gap-3">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask across indexed documents"
                className="min-h-11 flex-1 rounded-md border border-ink/15 bg-paper px-3 text-base outline-none ring-signal/30 focus:ring-4"
              />
              <button
                type="submit"
                disabled={!question.trim() || isAsking || !apiReady}
                className="flex h-11 items-center gap-2 rounded-md bg-moss px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                {isAsking ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />}
                Ask
              </button>
            </div>
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
            {message.citations.map((citation) => (
              <details key={citation.chunk_id} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-moss">
                  {citation.document_name} - {citation.chunk_id}
                </summary>
                {citation.quote && <p className="mt-2 text-ink/75">{citation.quote}</p>}
              </details>
            ))}
          </div>
        )}
      </div>
      {isUser && <User className="mt-2 shrink-0 text-signal" size={22} />}
    </article>
  );
}
