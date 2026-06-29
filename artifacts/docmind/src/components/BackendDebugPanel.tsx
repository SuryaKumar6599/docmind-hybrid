import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { getConfigAgeSeconds, isUsingDynamicConfig } from "../lib/useApiUrl";

interface HealthFull {
  status: "ok" | "degraded" | "down";
  ollama: { reachable: boolean; models: Record<string, boolean> };
  supabase: { configured: boolean; reachable: boolean };
  tunnel: { known: boolean; url: string | null };
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-fern" : "bg-red-500"}`} />;
}

/** Small debug-friendly status panel. Collapsed by default — for diagnosing
 * a stuck connection without needing the terminal. */
export function BackendDebugPanel({ apiUrl }: { apiUrl: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HealthFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  async function refresh() {
    if (!apiUrl) { setErr("No backend URL resolved yet."); return; }
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`${apiUrl}/health/full`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setLastChecked(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
      setLastChecked(new Date());
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) refresh();
  }

  const configAge = getConfigAgeSeconds();

  return (
    <section className="rounded-lg border border-ink/10 bg-white/80 shadow-sm">
      <button onClick={toggle} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="text-xs font-medium text-ink/40">Debug info</span>
        {open ? <ChevronUp size={13} className="text-ink/30" /> : <ChevronDown size={13} className="text-ink/30" />}
      </button>

      {open && (
        <div className="border-t border-ink/10 px-4 py-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-ink/35">
              {lastChecked ? `Checked ${lastChecked.toLocaleTimeString()}` : "Not checked yet"}
            </span>
            <button onClick={refresh} disabled={loading} className="flex items-center gap-1 text-ink/40 hover:text-ink disabled:opacity-50">
              {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Refresh
            </button>
          </div>

          {err && <p className="mb-2 rounded bg-red-50 px-2 py-1.5 text-red-600">{err}</p>}

          {data && (
            <dl className="space-y-1.5 text-ink/65">
              <div className="flex items-center justify-between">
                <dt>Backend connected</dt>
                <dd className="flex items-center gap-1.5"><Dot ok={data.status !== "down"} /> {data.status}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Ollama</dt>
                <dd className="flex items-center gap-1.5"><Dot ok={data.ollama.reachable} /> {data.ollama.reachable ? "reachable" : "unreachable"}</dd>
              </div>
              {data.ollama.reachable && (
                <div className="flex items-center justify-between pl-3 text-ink/45">
                  <dt>Models (chat/vision/embed/premium)</dt>
                  <dd>
                    {["chat", "vision", "embed", "premium_chat"].map((m) => (data.ollama.models[m] ? "✓" : "✗")).join(" ")}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt>Supabase reachable</dt>
                <dd className="flex items-center gap-1.5"><Dot ok={data.supabase.reachable} /> {data.supabase.reachable ? "yes" : "no"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Tunnel URL found</dt>
                <dd className="flex items-center gap-1.5"><Dot ok={data.tunnel.known} /> {data.tunnel.known ? "yes" : "no"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Supabase config loaded</dt>
                <dd>
                  {!isUsingDynamicConfig() ? "n/a (env var)" : configAge != null ? `${configAge}s ago` : "no"}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
