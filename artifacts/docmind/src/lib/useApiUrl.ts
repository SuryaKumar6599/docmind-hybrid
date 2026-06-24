import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const CONFIG_BUCKET_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/docmind-config/api_url.json`
  : null;
const REFRESH_MS = 45000;

let cachedApiUrl: string | null = null;

function cleanApiUrl(url: string | undefined) {
  return url?.trim().replace(/\/+$/, "") || "";
}

async function fetchDynamicApiUrl() {
  if (!CONFIG_BUCKET_URL) return "";
  const response = await fetch(`${CONFIG_BUCKET_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const config = await response.json();
  return cleanApiUrl(config?.api_url as string | undefined);
}

export function useApiUrl() {
  const [apiUrl, setApiUrl] = useState<string>(cachedApiUrl || "");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const envUrl = cleanApiUrl(import.meta.env.VITE_DOCMIND_API_URL as string | undefined);

    const useUrl = (url: string) => {
      if (cancelled || !url) return;
      cachedApiUrl = url;
      setApiUrl(url);
    };

    const refresh = () => {
      fetchDynamicApiUrl()
        .then((dynamicUrl) => useUrl(dynamicUrl || envUrl))
        .catch((err) => {
          console.warn("[DocMind] Could not fetch dynamic API URL from bucket:", err);
          useUrl(envUrl);
        })
        .finally(() => {
          if (!cancelled && CONFIG_BUCKET_URL) {
            timer = window.setTimeout(refresh, REFRESH_MS);
          }
        });
    };

    if (CONFIG_BUCKET_URL) {
      refresh();
    } else {
      useUrl(envUrl);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return apiUrl;
}
