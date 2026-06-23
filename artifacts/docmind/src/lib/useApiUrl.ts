import { useEffect, useState } from "react";
import { supabase } from "./supabase";

let cachedApiUrl: string | null = null;

export function useApiUrl() {
  const [apiUrl, setApiUrl] = useState<string>("");

  useEffect(() => {
    if (cachedApiUrl) {
      setApiUrl(cachedApiUrl);
      return;
    }

    // 1. Fallback to Env variable if set (for Vercel manually or local dev)
    const envUrl = (import.meta.env.VITE_DOCMIND_API_URL as string | undefined)?.replace(/\/+$/, "");
    if (envUrl) {
      cachedApiUrl = envUrl;
      setApiUrl(envUrl);
      return;
    }

    // 2. Fetch from Supabase (automated Cloudflare tunnel script sets this)
    if (supabase) {
      supabase
        .from("documents")
        .select("metadata")
        .eq("name", "__DOCMIND_API_CONFIG__")
        .single()
        .then(({ data }) => {
          if (data?.metadata?.api_url) {
            cachedApiUrl = data.metadata.api_url.replace(/\/+$/, "");
            setApiUrl(cachedApiUrl);
          }
        })
        .catch(console.error);
    }
  }, []);

  return apiUrl;
}
