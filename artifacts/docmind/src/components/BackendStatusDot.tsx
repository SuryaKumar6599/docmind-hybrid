import type { BackendStatus } from "../lib/useBackendStatus";

const DOT_COLOR: Record<BackendStatus, string> = {
  connected: "bg-fern",
  starting: "bg-amber animate-pulse",
  offline: "bg-red-500",
};

const LABEL: Record<BackendStatus, string> = {
  connected: "Connected",
  starting: "Starting",
  offline: "Offline",
};

function tooltipFor(status: BackendStatus, apiUrl: string): string {
  if (status === "connected") return apiUrl ? `Local backend connected — ${apiUrl}` : "Local backend connected";
  if (status === "starting") return "Local backend starting…";
  return apiUrl
    ? `Local backend unreachable — start FastAPI + Cloudflare Tunnel then refresh.`
    : `No backend URL configured — set VITE_DOCMIND_API_URL.`;
}

/** Small colored dot only. Drop-in replacement for the old amber/green ApiDot. */
export function BackendStatusDot({ status, apiUrl }: { status: BackendStatus; apiUrl: string }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_COLOR[status]}`} title={tooltipFor(status, apiUrl)} />;
}

/** Dot + short text label, for places that show status inline (e.g. sidebar card). */
export function BackendStatusBadge({ status, apiUrl }: { status: BackendStatus; apiUrl: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-ink/50" title={tooltipFor(status, apiUrl)}>
      <BackendStatusDot status={status} apiUrl={apiUrl} />
      {LABEL[status]}
    </span>
  );
}
