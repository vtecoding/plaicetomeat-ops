"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type CounterConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "stale"
  | "failed"
  | "polling";

const POLL_INTERVAL_MS = 15_000;
const SUBSCRIBE_TIMEOUT_MS = 12_000;
const MAX_REALTIME_RETRIES = 3;
const REFETCH_DEBOUNCE_MS = 250;

/**
 * Branch-scoped Supabase realtime for the counter board. The connection badge
 * reflects the *actual* channel state; when realtime cannot be established the
 * hook honestly degrades to interval polling instead of pretending to be live.
 */
export function useCounterRealtime(opts: {
  branchId: string;
  refetch: () => Promise<boolean>;
  forcePolling?: boolean;
}) {
  const { branchId, refetch, forcePolling } = opts;
  const [state, setState] = useState<CounterConnectionState>(forcePolling ? "polling" : "connecting");

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retriesRef = useRef(0);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void refetchRef.current();
    }, REFETCH_DEBOUNCE_MS);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (nextState: CounterConnectionState) => {
      setState(nextState);
      if (pollRef.current) {
        return;
      }
      pollRef.current = setInterval(() => {
        void (async () => {
          const ok = await refetchRef.current();
          setState((current) => (current === "live" ? current : ok ? "polling" : "stale"));
        })();
      }, POLL_INTERVAL_MS);
    },
    [],
  );

  useEffect(() => {
    if (forcePolling) {
      startPolling("polling");
      void refetchRef.current();
      return () => stopPolling();
    }

    let cancelled = false;
    let client: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    let channel: RealtimeChannel | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      client = createSupabaseBrowserClient();
    } catch {
      // No public Supabase env in the browser — degrade honestly.
      startPolling("polling");
      void refetchRef.current();
      return () => stopPolling();
    }

    const activeClient = client;

    void (async () => {
      const { data } = await activeClient.auth.getSession();

      if (cancelled) {
        return;
      }

      if (data.session?.access_token) {
        activeClient.realtime.setAuth(data.session.access_token);
      }

      const filter = `branch_id=eq.${branchId}`;

      channel = activeClient
        .channel(`counter:${branchId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "order_status_events", filter }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "order_notes", filter }, scheduleRefetch)
        .subscribe((status) => {
          if (cancelled) {
            return;
          }

          if (status === "SUBSCRIBED") {
            retriesRef.current = 0;
            stopPolling();
            setState("live");
            // Catch up on anything missed while (re)connecting.
            void refetchRef.current();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            retriesRef.current += 1;
            if (retriesRef.current >= MAX_REALTIME_RETRIES) {
              startPolling("polling");
            } else {
              setState("reconnecting");
            }
          } else if (status === "CLOSED") {
            setState((current) => (current === "polling" ? current : "reconnecting"));
          }
        });

      timeout = setTimeout(() => {
        if (!cancelled) {
          setState((current) => (current === "live" || current === "polling" ? current : "reconnecting"));
        }
      }, SUBSCRIBE_TIMEOUT_MS);
    })();

    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      stopPolling();
      if (channel) {
        void activeClient.removeChannel(channel);
      }
    };
  }, [branchId, forcePolling, scheduleRefetch, startPolling, stopPolling]);

  return { state };
}
