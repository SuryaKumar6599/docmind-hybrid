import { useEffect, useMemo, useState } from "react";
import { useApiUrl } from "../lib/useApiUrl";

export type BackendStatus = "starting" | "connected" | "offline";

type HealthPayload = {
  status?: string;
  runtime?: string;
  checks?: Record<string, boolean>;
};

export type BackendStatusResult = {
  apiUrl: string;
  status: BackendStatus;
  online: boolean | null;
  label: string;
  detail: string;
  checkedAt: Date | null;
  health: HealthPayload | null;
};

const RETRY_DELAYS = [0, 2000, 4000];
const REFRESH_MS = 30000;

export function useBackendStatus(): BackendStatusResult {
  const apiUrl = useApiUrl();
  const [status, setStatus] = useState<BackendStatus>("starting");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let refreshTimer: number | undefined;

    if (!apiUrl) {
      setStatus("starting");
      setHealth(null);
      setCheckedAt(null);
      return;
    }

    async function probe(attempt = 0) {
      if (cancelled) return;
      if (attempt === 0) setStatus((current) => current === "connected" ? current : "starting");

      try {
        const response = await fetch(`${apiUrl}/health/full`, { signal: AbortSignal.timeout(3500) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as HealthPayload;
        if (cancelled) return;
        setHealth(payload);
        setCheckedAt(new Date());
        setStatus("connected");
        refreshTimer = window.setTimeout(() => probe(0), REFRESH_MS);
      } catch {
        if (cancelled) return;
        if (attempt < RETRY_DELAYS.length - 1) {
          setStatus("starting");
          retryTimer = window.setTimeout(() => probe(attempt + 1), RETRY_DELAYS[attempt + 1]);
          return;
        }
        setHealth(null);
        setCheckedAt(new Date());
        setStatus("offline");
        refreshTimer = window.setTimeout(() => probe(0), REFRESH_MS);
      }
    }

    probe();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [apiUrl]);

  return useMemo(() => {
    const online = status === "connected" ? true : status === "offline" ? false : null;
    const ollamaOk = health?.checks?.ollama;
    const label = status === "connected"
      ? (ollamaOk === false ? "Backend connected, Ollama degraded" : "Backend connected")
      : status === "starting"
        ? (apiUrl ? "Backend starting" : "Resolving backend URL")
        : "Backend offline";
    const detail = status === "connected"
      ? apiUrl
      : status === "starting"
        ? "Checking local FastAPI and tunnel"
        : "FastAPI or tunnel is not responding";

    return { apiUrl, status, online, label, detail, checkedAt, health };
  }, [apiUrl, checkedAt, health, status]);
}
