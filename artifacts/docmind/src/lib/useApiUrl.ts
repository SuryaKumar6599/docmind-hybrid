import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const CONFIG_BUCKET_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/docmind-config/api_url.json`
  : null;

let cachedApiUrl: string | null = null;

function cleanApiUrl(url: string | undefined) {
  return url?.trim().replace(/\/+$/, "") || "";
}

export function useApiUrl() {
  const [apiUrl, setApiUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    if (cachedApiUrl) {
      setApiUrl(cachedApiUrl);
      return;
    }

    // Fallback only. Vite env values are baked at build time, but Cloudflare
    // quick-tunnel URLs change at runtime.
    const envUrl = cleanApiUrl(import.meta.env.VITE_DOCMIND_API_URL as string | undefined);

    const useUrl = (url: string) => {
      if (cancelled || !url) return;
      cachedApiUrl = url;
      setApiUrl(url);
    };

    // 1. Runtime config written by backend/app/tunnel_manager.py on startup.
    //    This lets the deployed frontend follow changing trycloudflare URLs.
    if (CONFIG_BUCKET_URL) {
      fetch(`${CONFIG_BUCKET_URL}?t=${Date.now()}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((text) => {
          const config = JSON.parse(text);
          const dynamicUrl = cleanApiUrl(config?.api_url as string | undefined);
          useUrl(dynamicUrl || envUrl);
        })
        .catch((err) => {
          console.warn("[DocMind] Could not fetch dynamic API URL from bucket:", err);
          useUrl(envUrl);
        });
      return () => {
        cancelled = true;
      };
    }

    // 2. Env variable for local/offline setups without Supabase config.
    if (envUrl) {
      useUrl(envUrl);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return apiUrl;
}
