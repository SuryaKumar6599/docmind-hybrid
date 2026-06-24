import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const CONFIG_BUCKET_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/docmind-config/api_url.json`
  : null;

const REFRESH_INTERVAL_MS = 45_000; // re-check the dynamic tunnel URL every 45s

let cachedApiUrl: string | null = null;
let cachedConfigUpdatedAt: number | null = null; // epoch seconds, from tunnel_manager.py
let pollingStarted = false;
const subscribers = new Set<(url: string) => void>();

function cleanApiUrl(url: string | undefined) {
  return url?.trim().replace(/\/+$/, "") || "";
}

function broadcast(url: string) {
  cachedApiUrl = url;
  subscribers.forEach((fn) => fn(url));
}

function fetchDynamicUrl(envUrl: string) {
  if (!CONFIG_BUCKET_URL) return;
  fetch(`${CONFIG_BUCKET_URL}?t=${Date.now()}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((text) => {
      const config = JSON.parse(text);
      const dynamicUrl = cleanApiUrl(config?.api_url as string | undefined);
      cachedConfigUpdatedAt = typeof config?.updated_at === "number" ? config.updated_at : null;
      const resolved = dynamicUrl || envUrl;
      if (resolved && resolved !== cachedApiUrl) broadcast(resolved);
    })
    .catch((err) => {
      // Bucket unreachable or config stale/missing: keep using the last
      // known-good URL instead of clearing it, and only fall back to the
      // build-time env var if we've never resolved anything at all.
      console.warn("[DocMind] Could not refresh dynamic API URL from bucket:", err);
      if (!cachedApiUrl && envUrl) broadcast(envUrl);
    });
}

function startPolling(envUrl: string) {
  if (pollingStarted) return;
  pollingStarted = true;
  fetchDynamicUrl(envUrl);
  setInterval(() => fetchDynamicUrl(envUrl), REFRESH_INTERVAL_MS);
}

/** Seconds since the Supabase bucket config (api_url.json) was last written by tunnel_manager.py, or null if unknown. */
export function getConfigAgeSeconds(): number | null {
  if (cachedConfigUpdatedAt == null) return null;
  return Math.max(0, Math.round(Date.now() / 1000) - cachedConfigUpdatedAt);
}

export function isUsingDynamicConfig(): boolean {
  return CONFIG_BUCKET_URL !== null;
}

export function useApiUrl() {
  const [apiUrl, setApiUrl] = useState<string>(cachedApiUrl ?? "");

  useEffect(() => {
    subscribers.add(setApiUrl);

    const envUrl = cleanApiUrl(import.meta.env.VITE_DOCMIND_API_URL as string | undefined);
    if (CONFIG_BUCKET_URL) {
      startPolling(envUrl);
    } else if (envUrl && !cachedApiUrl) {
      broadcast(envUrl);
    }

    return () => {
      subscribers.delete(setApiUrl);
    };
  }, []);

  return apiUrl;
}
