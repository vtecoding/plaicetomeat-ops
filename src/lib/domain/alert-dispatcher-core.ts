/**
 * V18 B1 Phase 2 — runtime-agnostic dispatcher sweep.
 *
 * One invocation = recover expired leases, lease bounded batches, send with
 * bounded concurrency, record every outcome, return metrics. No hidden state,
 * no in-memory queue, no background loops: everything durable lives in the
 * Phase 1 outbox, so any number of invocations (Edge Function, interim
 * scheduled worker, verification harness) can safely coexist — FOR UPDATE
 * SKIP LOCKED in the lease RPC is the only concurrency authority.
 *
 * This module must stay importable by Deno (edge runtime), Node (vitest, the
 * DB guard) and tsc alike: explicit .ts extensions, no runtime globals beyond
 * standard ECMAScript + Date.
 */
import {
  ALERT_DISPATCH_LEASE_SECONDS,
  boundDispatchBatch,
  processLeasedAlertDispatches,
  type LeasedAlertDispatch,
  type ProviderSendResult,
} from "./alert-dispatch.ts";
import { OwnerAlertProviderError } from "./owner-alert-channel.ts";

export const DISPATCHER_VERSION = "v18-b1-phase2.1";

export const CHANNEL_UNSUPPORTED = "CHANNEL_UNSUPPORTED";
export const CHANNEL_DISABLED = "CHANNEL_DISABLED";

export type DispatcherRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export type DispatchChannelAdapter = {
  channel: string;
  /** Whether this dispatch can actually be sent (credentials + target present). */
  isConfigured: (row: LeasedAlertDispatch) => boolean;
  send: (row: LeasedAlertDispatch) => Promise<ProviderSendResult>;
};

export type DispatcherConfig = {
  /** Rows per lease call. The SQL RPC hard-caps at 25. */
  batchSize: number;
  /** Maximum provider sends in flight at once. */
  maxConcurrentSends: number;
  /** Stop leasing new work once this much wall clock has elapsed. */
  softDeadlineMs: number;
  /** Lease duration passed to the lease RPC. */
  leaseSeconds: number;
};

export const DEFAULT_DISPATCHER_CONFIG: DispatcherConfig = {
  batchSize: 20,
  maxConcurrentSends: 5,
  softDeadlineMs: 20_000,
  leaseSeconds: ALERT_DISPATCH_LEASE_SECONDS,
};

export type DispatchAttemptLog = {
  event: "alert_dispatch_attempt";
  invocation_id: string;
  dispatch_id: string;
  attempt: number;
  channel: string;
  outcome: string;
  status_after: string | null;
  provider_code: string | null;
  latency_ms: number;
  duration_ms: number;
};

export type DispatcherMetrics = {
  invocation_id: string;
  version: string;
  expired_leases: number;
  leased: number;
  processed: number;
  accepted: number;
  retry_wait: number;
  delivery_unknown: number;
  dead_letter: number;
  skipped: number;
  failed_sends: number;
  record_failures: number;
  batches: number;
  soft_deadline_hit: boolean;
  duration_ms: number;
  remaining_budget_ms: number;
};

type RecordedRow = { status?: string | null } | null | undefined;

function splitIntoLanes<T>(rows: T[], laneCount: number): T[][] {
  const lanes: T[][] = Array.from({ length: Math.max(1, laneCount) }, () => []);
  rows.forEach((row, index) => lanes[index % lanes.length].push(row));
  return lanes.filter((lane) => lane.length > 0);
}

/**
 * One stateless dispatcher sweep. Never throws for per-dispatch failures: a
 * failed record leaves the row leased, the lease expires, and the next sweep
 * recovers it as delivery_unknown — that is the no-silent-loss path, so the
 * invocation itself always returns metrics cleanly.
 */
export async function runDispatcherSweep(input: {
  invocationId: string;
  callRpc: DispatcherRpc;
  adapters: Record<string, DispatchChannelAdapter>;
  config?: Partial<DispatcherConfig>;
  now?: () => number;
  log?: (entry: DispatchAttemptLog | Record<string, unknown>) => void;
}): Promise<DispatcherMetrics> {
  const config: DispatcherConfig = { ...DEFAULT_DISPATCHER_CONFIG, ...input.config };
  const now = input.now ?? Date.now;
  const log = input.log ?? (() => undefined);
  const startedAt = now();
  const elapsed = () => now() - startedAt;

  const metrics: DispatcherMetrics = {
    invocation_id: input.invocationId,
    version: DISPATCHER_VERSION,
    expired_leases: 0,
    leased: 0,
    processed: 0,
    accepted: 0,
    retry_wait: 0,
    delivery_unknown: 0,
    dead_letter: 0,
    skipped: 0,
    failed_sends: 0,
    record_failures: 0,
    batches: 0,
    soft_deadline_hit: false,
    duration_ms: 0,
    remaining_budget_ms: 0,
  };

  const recovered = await input.callRpc("recover_expired_alert_dispatch_leases_v18", {});
  metrics.expired_leases = typeof recovered === "number" ? recovered : Number(recovered ?? 0) || 0;

  const recordRow = async (row: LeasedAlertDispatch, args: {
    outcome: string;
    providerMessageId: string | null;
    providerStatusCode: string | null;
    errorCode: string | null;
    errorDetail: string | null;
    invalidateDevice: boolean;
    latencyMs: number;
    rowStartedAt: number;
  }) => {
    const recordedRaw = (await input.callRpc("record_alert_dispatch_result_v18", {
      p_dispatch_id: row.id,
      p_worker_id: input.invocationId,
      p_outcome: args.outcome,
      p_provider_message_id: args.providerMessageId,
      p_provider_status_code: args.providerStatusCode,
      p_error_code: args.errorCode,
      p_error_detail: args.errorDetail,
      p_invalidate_device: args.invalidateDevice,
    })) as RecordedRow;
    const statusAfter = recordedRaw?.status ?? null;
    metrics.processed += 1;
    if (statusAfter === "accepted") metrics.accepted += 1;
    else if (statusAfter === "retry_wait") metrics.retry_wait += 1;
    else if (statusAfter === "delivery_unknown") metrics.delivery_unknown += 1;
    else if (statusAfter === "dead_letter") metrics.dead_letter += 1;
    else if (statusAfter === "skipped") metrics.skipped += 1;
    if (args.outcome !== "accepted" && args.outcome !== "skipped") metrics.failed_sends += 1;
    log({
      event: "alert_dispatch_attempt",
      invocation_id: input.invocationId,
      dispatch_id: row.id,
      attempt: row.attempt_count,
      channel: row.channel,
      outcome: args.outcome,
      status_after: statusAfter,
      provider_code: args.providerStatusCode ?? args.errorCode,
      latency_ms: Math.max(0, Math.round(args.latencyMs)),
      duration_ms: Math.max(0, Math.round(now() - args.rowStartedAt)),
    } satisfies DispatchAttemptLog);
  };

  const processLane = async (lane: LeasedAlertDispatch[]) => {
    const rowTimings = new Map<string, { rowStartedAt: number; latencyMs: number }>();
    await processLeasedAlertDispatches({
      rows: lane,
      channelConfigured: (row) => {
        const adapter = input.adapters[row.channel];
        return Boolean(adapter && adapter.isConfigured(row));
      },
      disabledReason: CHANNEL_DISABLED,
      send: async (row) => {
        const timing = { rowStartedAt: now(), latencyMs: 0 };
        rowTimings.set(row.id, timing);
        const sendStartedAt = now();
        try {
          return await input.adapters[row.channel].send(row);
        } finally {
          timing.latencyMs = now() - sendStartedAt;
        }
      },
      record: async (dispatchId, result) => {
        const row = lane.find((candidate) => candidate.id === dispatchId)!;
        const timing = rowTimings.get(dispatchId) ?? { rowStartedAt: now(), latencyMs: 0 };
        const missingAdapter = result.outcome === "skipped" && !input.adapters[row.channel];
        await recordRow(row, {
          outcome: result.outcome,
          providerMessageId: result.providerMessageId,
          providerStatusCode: result.providerStatusCode,
          errorCode: missingAdapter ? CHANNEL_UNSUPPORTED : result.errorCode,
          errorDetail: missingAdapter
            ? `No ${row.channel} adapter is registered in this dispatcher build; replay after the channel ships.`
            : result.errorDetail,
          invalidateDevice: result.invalidateDevice,
          latencyMs: timing.latencyMs,
          rowStartedAt: timing.rowStartedAt,
        });
      },
      classifySendError: (error) => {
        const providerError = error instanceof OwnerAlertProviderError ? error : null;
        return {
          message: error instanceof Error ? error.message : "Provider send failed",
          outcome: providerError?.outcome ?? "ambiguous",
          errorCode: providerError?.errorCode ?? null,
          invalidateDevice: providerError?.invalidateDevice ?? false,
        };
      },
    });
  };

  while (true) {
    if (elapsed() >= config.softDeadlineMs) {
      metrics.soft_deadline_hit = true;
      break;
    }

    const batchSize = boundDispatchBatch(config.batchSize);
    const leasedRaw = await input.callRpc("lease_alert_dispatches_v18", {
      p_worker_id: input.invocationId,
      p_limit: batchSize,
      p_lease_seconds: config.leaseSeconds,
    });
    const rows = (Array.isArray(leasedRaw) ? leasedRaw : []) as LeasedAlertDispatch[];
    if (rows.length === 0) break;

    metrics.batches += 1;
    metrics.leased += rows.length;

    const lanes = splitIntoLanes(rows, config.maxConcurrentSends);
    const results = await Promise.allSettled(lanes.map(processLane));
    for (const result of results) {
      if (result.status === "rejected") {
        // A record RPC failure aborts its lane; the unrecorded rows stay
        // leased and are recovered as delivery_unknown after lease expiry.
        metrics.record_failures += 1;
        log({
          event: "alert_dispatch_lane_error",
          invocation_id: input.invocationId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    if (rows.length < batchSize) break;
  }

  metrics.duration_ms = Math.max(0, Math.round(elapsed()));
  metrics.remaining_budget_ms = Math.max(0, Math.round(config.softDeadlineMs - elapsed()));
  return metrics;
}
