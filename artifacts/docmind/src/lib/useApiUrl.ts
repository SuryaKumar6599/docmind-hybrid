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

    // 2. Fetch from Supabase public config bucket (automated Cloudflare tunnel script sets this)
    if (supabase) {
      const { data } = supabase.storage.from("docmind-config").getPublicUrl("api_url.json");
      if (data?.publicUrl) {
        // Fetch the JSON from the public URL
        fetch(data.publicUrl, { cache: "no-store" })
          .then((res) => {
            if (!res.ok) throw new Error("Config not found");
            return res.json();
          })
          .then((config) => {
            if (config?.api_url) {
              cachedApiUrl = config.api_url.replace(/\/+$/, "");
              setApiUrl(cachedApiUrl);
            }
          })
          .catch((err) => {
            console.error("Failed to fetch dynamic API URL:", err);
          });
      }
    }
  }, []);

  return apiUrl;
}
