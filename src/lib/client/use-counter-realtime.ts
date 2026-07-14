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
const LIVE_SAFETY_REFRESH_INTERVAL_MS = 2_000;
const SUBSCRIBE_TIMEOUT_MS = 12_000;
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
  const liveSafetyRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveSafetyRefreshPendingRef = useRef(false);

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

  const stopLiveSafetyRefresh = useCallback(() => {
    if (liveSafetyRefreshRef.current) {
      clearInterval(liveSafetyRefreshRef.current);
      liveSafetyRefreshRef.current = null;
    }
    liveSafetyRefreshPendingRef.current = false;
  }, []);

  const startLiveSafetyRefresh = useCallback(() => {
    if (liveSafetyRefreshRef.current) {
      return;
    }

    // A subscribed socket is not proof that every CDC event was delivered.
    // This bounded catch-up sweep keeps the board fresh through dropped events
    // while the badge continues to report the channel's actual state.
    liveSafetyRefreshRef.current = setInterval(() => {
      if (liveSafetyRefreshPendingRef.current) {
        return;
      }
      liveSafetyRefreshPendingRef.current = true;
      void refetchRef.current().finally(() => {
        liveSafetyRefreshPendingRef.current = false;
      });
    }, LIVE_SAFETY_REFRESH_INTERVAL_MS);
  }, []);

  const startPolling = useCallback(
    (nextState: CounterConnectionState, intervalMs = POLL_INTERVAL_MS) => {
      setState(nextState);
      if (pollRef.current) {
        return;
      }
      pollRef.current = setInterval(() => {
        void (async () => {
          const ok = await refetchRef.current();
          setState((current) => (current === "live" ? current : ok ? nextState : "stale"));
        })();
      }, intervalMs);
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
    let subscribed = false;

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
      const { data, error } = await activeClient.auth.getSession();

      if (cancelled) {
        return;
      }

      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        startPolling("reconnecting", LIVE_SAFETY_REFRESH_INTERVAL_MS);
        void refetchRef.current();
        return;
      }

      try {
        await activeClient.realtime.setAuth(accessToken);
      } catch {
        startPolling("reconnecting", LIVE_SAFETY_REFRESH_INTERVAL_MS);
        void refetchRef.current();
        return;
      }

      if (cancelled) {
        return;
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
            subscribed = true;
            stopPolling();
            startLiveSafetyRefresh();
            setState("live");
            // Catch up on anything missed while (re)connecting.
            void refetchRef.current();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            subscribed = false;
            stopLiveSafetyRefresh();
            startPolling("reconnecting", LIVE_SAFETY_REFRESH_INTERVAL_MS);
          } else if (status === "CLOSED") {
            subscribed = false;
            stopLiveSafetyRefresh();
            startPolling("reconnecting", LIVE_SAFETY_REFRESH_INTERVAL_MS);
          }
        });

      timeout = setTimeout(() => {
        if (!cancelled && !subscribed) {
          startPolling("reconnecting", LIVE_SAFETY_REFRESH_INTERVAL_MS);
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
      stopLiveSafetyRefresh();
      if (channel) {
        void activeClient.removeChannel(channel);
      }
    };
  }, [
    branchId,
    forcePolling,
    scheduleRefetch,
    startLiveSafetyRefresh,
    startPolling,
    stopLiveSafetyRefresh,
    stopPolling,
  ]);

  return { state };
}
