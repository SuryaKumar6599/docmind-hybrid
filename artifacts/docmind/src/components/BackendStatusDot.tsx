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
  if (status === "connected") {
    return apiUrl
      ? `Backend connected — ${apiUrl}`
      : "Backend connected";
  }

  if (status === "starting") {
    return "Waiting for tunnel URL or backend health check...";
  }

  return apiUrl
    ? "Backend unreachable. Waiting for next health check."
    : "Waiting for tunnel URL from Supabase configuration.";
}

export function BackendStatusDot({
  status,
  apiUrl,
}: {
  status: BackendStatus;
  apiUrl: string;
}) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_COLOR[status]}`}
      title={tooltipFor(status, apiUrl)}
    />
  );
}

export function BackendStatusBadge({
  status,
  apiUrl,
}: {
  status: BackendStatus;
  apiUrl: string;
}) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs font-medium text-ink/50"
      title={tooltipFor(status, apiUrl)}
    >
      <BackendStatusDot status={status} apiUrl={apiUrl} />
      {LABEL[status]}
    </span>
  );
}