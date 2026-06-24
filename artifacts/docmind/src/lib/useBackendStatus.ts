import { useEffect, useRef, useState } from "react";
import { useApiUrl } from "./useApiUrl";

export type BackendStatus = "connected" | "starting" | "offline";

const RETRY_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 3000;
const RECHECK_INTERVAL_MS = 45000;
const HEALTH_TIMEOUT_MS = 4000;
const NO_URL_GRACE_MS = 15000;

/**
 * Centralizes backend reachability checks so every page reports the same
 * status instead of each running its own ad-hoc fetch(`${API_URL}/health`).
 *
 * Status meanings:
 * - starting: waiting for tunnel URL or health checks still running
 * - connected: backend health endpoint returned success
 * - offline: tunnel URL exists but backend failed all retries
 */
export function useBackendStatus() {
  const apiUrl = useApiUrl();
  const [status, setStatus] = useState<BackendStatus>("starting");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    function clearTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function scheduleRecheck() {
      clearTimer();

      timerRef.current = setTimeout(() => {
        attempt = 0;
        probe();
      }, RECHECK_INTERVAL_MS);
    }

    function failOrRetry() {
      attempt += 1;

      if (attempt >= RETRY_ATTEMPTS) {
        setStatus("offline");
        scheduleRecheck();
        return;
      }

      setStatus("starting");

      clearTimer();

      timerRef.current = setTimeout(() => {
        probe();
      }, RETRY_INTERVAL_MS);
    }

    function probe() {
      if (!apiUrl) {
        setStatus("starting");
        return;
      }

      fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
        .then((res) => {
          if (cancelled) return;

          setLastChecked(new Date());

          if (res.ok) {
            setStatus("connected");
            scheduleRecheck();
          } else {
            failOrRetry();
          }
        })
        .catch(() => {
          if (cancelled) return;

          setLastChecked(new Date());
          failOrRetry();
        });
    }

    // IMPORTANT:
    // Don't show offline just because the tunnel URL
    // hasn't been loaded from Supabase yet.
    if (!apiUrl) {
      setStatus("starting");

      clearTimer();

      timerRef.current = setTimeout(() => {
        if (!cancelled) {
          setStatus("starting");
        }
      }, NO_URL_GRACE_MS);

      return () => {
        cancelled = true;
        clearTimer();
      };
    }

    probe();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [apiUrl]);

  return { apiUrl, status, lastChecked };
}