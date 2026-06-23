import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const CONFIG_BUCKET_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/docmind-config/api_url.json`
  : null;

let cachedApiUrl: string | null = null;

export function useApiUrl() {
  const [apiUrl, setApiUrl] = useState<string>("");

  useEffect(() => {
    if (cachedApiUrl) {
      setApiUrl(cachedApiUrl);
      return;
    }

    // 1. Env variable (set in Vercel → Settings → Environment Variables)
    const envUrl = (import.meta.env.VITE_DOCMIND_API_URL as string | undefined)?.replace(/\/+$/, "");
    if (envUrl) {
      cachedApiUrl = envUrl;
      setApiUrl(envUrl);
      return;
    }

    // 2. Fetch from public Supabase storage bucket — tunnel_manager.py writes here on startup
    //    Supabase storage returns Content-Type: text/plain so we parse manually.
    if (CONFIG_BUCKET_URL) {
      fetch(CONFIG_BUCKET_URL, { cache: "no-store" })
        .then((res) => res.text())
        .then((text) => {
          const config = JSON.parse(text);
          if (config?.api_url) {
            cachedApiUrl = (config.api_url as string).replace(/\/+$/, "");
            setApiUrl(cachedApiUrl);
          }
        })
        .catch((err) => {
          console.warn("[DocMind] Could not fetch dynamic API URL from bucket:", err);
        });
    }
  }, []);

  return apiUrl;
}
