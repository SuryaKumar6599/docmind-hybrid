import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

const CONFIG_BUCKET_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/docmind-config/api_url.json`
  : null;

const REFRESH_INTERVAL_MS = 30000;

let cachedApiUrl: string | null =
  sessionStorage.getItem("docmind_api_url") || null;

let cachedConfigUpdatedAt: number | null = null;

let pollingStarted = false;

const subscribers = new Set<(url: string) => void>();

function cleanApiUrl(url: string | undefined) {
  return url?.trim().replace(/\/+$/, "") || "";
}

function broadcast(url: string) {
  cachedApiUrl = url;

  try {
    sessionStorage.setItem("docmind_api_url", url);
  } catch {}

  subscribers.forEach((fn) => fn(url));
}

async function validateAndBroadcast(
  candidateUrl: string,
  envUrl: string
) {
  if (!candidateUrl) {
    if (!cachedApiUrl && envUrl) {
      broadcast(envUrl);
    }
    return;
  }

  try {
    const res = await fetch(
      `${candidateUrl}/health?t=${Date.now()}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    if (candidateUrl !== cachedApiUrl) {
      console.log(
        "[DocMind] Switched backend URL:",
        candidateUrl
      );
      broadcast(candidateUrl);
    }
  } catch (err) {
    console.warn(
      "[DocMind] Health check failed for tunnel:",
      candidateUrl,
      err
    );

    if (!cachedApiUrl && envUrl) {
      broadcast(envUrl);
    }
  }
}

async function fetchDynamicUrl(envUrl: string) {
  if (!CONFIG_BUCKET_URL) {
    if (!cachedApiUrl && envUrl) {
      broadcast(envUrl);
    }
    return;
  }

  try {
    const res = await fetch(
      `${CONFIG_BUCKET_URL}?t=${Date.now()}`,
      {
        cache: "no-store",
      }
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const config = await res.json();

    const dynamicUrl = cleanApiUrl(
      config?.api_url as string | undefined
    );

    cachedConfigUpdatedAt =
      typeof config?.updated_at === "number"
        ? config.updated_at
        : null;

    await validateAndBroadcast(
      dynamicUrl || envUrl,
      envUrl
    );
  } catch (err) {
    console.warn(
      "[DocMind] Could not refresh dynamic API URL:",
      err
    );

    if (!cachedApiUrl && envUrl) {
      broadcast(envUrl);
    }
  }
}

function startPolling(envUrl: string) {
  if (pollingStarted) return;

  pollingStarted = true;

  fetchDynamicUrl(envUrl);

  setInterval(() => {
    fetchDynamicUrl(envUrl);
  }, REFRESH_INTERVAL_MS);
}

/**
 * Seconds since tunnel_manager.py last updated api_url.json
 */
export function getConfigAgeSeconds(): number | null {
  if (cachedConfigUpdatedAt == null) {
    return null;
  }

  return Math.max(
    0,
    Math.round(Date.now() / 1000) -
      cachedConfigUpdatedAt
  );
}

export function isUsingDynamicConfig(): boolean {
  return CONFIG_BUCKET_URL !== null;
}

export function useApiUrl() {
  const [apiUrl, setApiUrl] = useState<string>(
    cachedApiUrl ?? ""
  );

  useEffect(() => {
    subscribers.add(setApiUrl);

    const envUrl = cleanApiUrl(
      import.meta.env.VITE_DOCMIND_API_URL as
        | string
        | undefined
    );

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