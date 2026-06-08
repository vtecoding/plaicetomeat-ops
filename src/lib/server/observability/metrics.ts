// V12.8 Observability — in-process operational counters.
//
// Deliberately edge-safe and dependency-light (NO `server-only`, no node builtins)
// so counters can be incremented from the Edge middleware, server actions, and
// route handlers alike.
//
// LIMITATION (documented, by design for this phase): counters live in process
// memory. They are per-runtime-instance and reset on cold start. They are a
// foundation for surfacing failure *rates* (e.g. via /api/health), not a durable
// time-series store. Forwarding to an external metrics system is a later,
// provider-specific phase (deferred — see docs/v12.8-discovery-report.md §10).

export const METRIC_NAMES = [
  "checkout_success",
  "checkout_failure",
  "checkout_partial_success",
  "login_success",
  "login_failure",
  "authority_denied",
  "inventory_stale_rejection",
  "checklist_completion_failure",
  "rpc_denied",
  "database_error",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

const counters = new Map<MetricName, number>(METRIC_NAMES.map((name) => [name, 0]));

export function incrementMetric(name: MetricName, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function getMetricsSnapshot(): Record<MetricName, number> {
  const snapshot = {} as Record<MetricName, number>;
  for (const name of METRIC_NAMES) {
    snapshot[name] = counters.get(name) ?? 0;
  }
  return snapshot;
}

/** Reset all counters to zero. Intended for tests and local diagnostics. */
export function resetMetrics(): void {
  for (const name of METRIC_NAMES) {
    counters.set(name, 0);
  }
}

// --- DB/RPC error classification -------------------------------------------
//
// A small shared helper so call sites consistently distinguish an authorisation
// denial (the V12.1 RPC seal doing its job, or a misconfigured grant) from a real
// database fault. Returns the metric name incremented, so callers can also log it.
export function noteRpcFault(error: { message?: string | null } | null | undefined): "rpc_denied" | "database_error" {
  const message = (error?.message ?? "").toLowerCase();
  const denied =
    message.includes("permission denied") ||
    message.includes("not authorized") ||
    message.includes("not authorised") ||
    message.includes("insufficient_privilege") ||
    message.includes("rls") ||
    message.includes("row-level security");
  const metric = denied ? "rpc_denied" : "database_error";
  incrementMetric(metric);
  return metric;
}
