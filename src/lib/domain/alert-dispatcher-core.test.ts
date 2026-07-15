import { describe, expect, it, vi } from "vitest";

import type { LeasedAlertDispatch } from "./alert-dispatch";
import {
  CHANNEL_UNSUPPORTED,
  DEFAULT_DISPATCHER_CONFIG,
  runDispatcherSweep,
  type DispatchAttemptLog,
  type DispatchChannelAdapter,
} from "./alert-dispatcher-core";
import { OwnerAlertProviderError } from "./owner-alert-channel";

function row(overrides: Partial<LeasedAlertDispatch> = {}): LeasedAlertDispatch {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    kind: "critical_alert",
    channel: "twilio_whatsapp",
    device_id: null,
    target: "+447700900001",
    dispatch_key: `critical-alert:${id}`,
    priority: 100,
    attempt_count: 1,
    payload: { message: "Help" },
    ...overrides,
  };
}

type RecordedCall = { dispatchId: string; outcome: string; errorCode: string | null };

/** In-memory stand-in for the three RPCs the sweep touches. */
function fakeRpc(queue: LeasedAlertDispatch[][], options: {
  expired?: number;
  statusFor?: (outcome: string) => string;
} = {}) {
  const recorded: RecordedCall[] = [];
  const leaseWorkerIds: string[] = [];
  const statusFor = options.statusFor ?? ((outcome: string) => (
    outcome === "accepted" ? "accepted"
      : outcome === "skipped" ? "skipped"
        : outcome === "ambiguous" ? "delivery_unknown"
          : outcome === "rejected_permanent" ? "dead_letter"
            : "retry_wait"
  ));
  const callRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "recover_expired_alert_dispatch_leases_v18") return options.expired ?? 0;
    if (name === "lease_alert_dispatches_v18") {
      leaseWorkerIds.push(String(args.p_worker_id));
      return queue.shift() ?? [];
    }
    if (name === "record_alert_dispatch_result_v18") {
      const outcome = String(args.p_outcome);
      recorded.push({
        dispatchId: String(args.p_dispatch_id),
        outcome,
        errorCode: (args.p_error_code as string | null) ?? null,
      });
      return { status: statusFor(outcome) };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  return { callRpc, recorded, leaseWorkerIds };
}

const acceptAll: DispatchChannelAdapter = {
  channel: "twilio_whatsapp",
  isConfigured: () => true,
  send: async () => ({ providerMessageId: "SM1", providerStatusCode: "201" }),
};

describe("edge dispatcher sweep", () => {
  it("recovers, leases, sends and records the full orchestration with correct metrics", async () => {
    const rows = [row(), row(), row()];
    const { callRpc, recorded } = fakeRpc([rows], { expired: 2 });
    const logs: DispatchAttemptLog[] = [];

    const metrics = await runDispatcherSweep({
      invocationId: "edge:test-1",
      callRpc,
      adapters: { twilio_whatsapp: acceptAll },
      log: (entry) => {
        if (entry.event === "alert_dispatch_attempt") logs.push(entry as DispatchAttemptLog);
      },
    });

    expect(metrics).toMatchObject({
      invocation_id: "edge:test-1",
      expired_leases: 2,
      leased: 3,
      processed: 3,
      accepted: 3,
      retry_wait: 0,
      dead_letter: 0,
      batches: 1,
      soft_deadline_hit: false,
      record_failures: 0,
    });
    expect(metrics.remaining_budget_ms).toBeGreaterThan(0);
    expect(recorded.map((call) => call.outcome)).toEqual(["accepted", "accepted", "accepted"]);
    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({
      event: "alert_dispatch_attempt",
      invocation_id: "edge:test-1",
      channel: "twilio_whatsapp",
      outcome: "accepted",
      status_after: "accepted",
      attempt: 1,
      provider_code: "201",
    });
  });

  it("stops leasing after the soft deadline and reports it", async () => {
    const fullBatch = Array.from({ length: 2 }, () => row());
    const secondBatch = [row()];
    const { callRpc } = fakeRpc([fullBatch, secondBatch]);
    let clock = 0;
    const now = () => clock;

    const metrics = await runDispatcherSweep({
      invocationId: "edge:test-deadline",
      callRpc,
      adapters: {
        twilio_whatsapp: {
          ...acceptAll,
          send: async () => {
            clock += 15_000; // each send burns 15s of the 20s budget
            return { providerMessageId: "SM1", providerStatusCode: "201" };
          },
        },
      },
      config: { batchSize: 2, maxConcurrentSends: 1 },
      now,
    });

    // First full batch processed (30s elapsed), second lease is never begun.
    expect(metrics.batches).toBe(1);
    expect(metrics.leased).toBe(2);
    expect(metrics.soft_deadline_hit).toBe(true);
    expect(metrics.remaining_budget_ms).toBe(0);
    expect(callRpc.mock.calls.filter(([name]) => name === "lease_alert_dispatches_v18")).toHaveLength(1);
  });

  it("never exceeds the configured send concurrency", async () => {
    const rows = Array.from({ length: 12 }, () => row());
    const { callRpc } = fakeRpc([rows]);
    let inFlight = 0;
    let peak = 0;

    await runDispatcherSweep({
      invocationId: "edge:test-concurrency",
      callRpc,
      adapters: {
        twilio_whatsapp: {
          ...acceptAll,
          send: async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
            return { providerMessageId: "SM1", providerStatusCode: "201" };
          },
        },
      },
      config: { batchSize: 12, maxConcurrentSends: 5 },
    });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("skips unsupported channels terminally-visibly instead of dead-lettering or crashing", async () => {
    const pushRow = row({ channel: "web_push", target: "" });
    const { callRpc, recorded } = fakeRpc([[pushRow]]);

    const metrics = await runDispatcherSweep({
      invocationId: "edge:test-unsupported",
      callRpc,
      adapters: { twilio_whatsapp: acceptAll },
    });

    expect(recorded).toEqual([
      { dispatchId: pushRow.id, outcome: "skipped", errorCode: CHANNEL_UNSUPPORTED },
    ]);
    expect(metrics.skipped).toBe(1);
    expect(metrics.failed_sends).toBe(0);
  });

  it("passes provider classifications through to the record RPC", async () => {
    const goneRow = row();
    const { callRpc, recorded } = fakeRpc([[goneRow]]);

    const metrics = await runDispatcherSweep({
      invocationId: "edge:test-classify",
      callRpc,
      adapters: {
        twilio_whatsapp: {
          ...acceptAll,
          send: async () => {
            throw new OwnerAlertProviderError("subscription gone", "rejected_permanent", "410", true);
          },
        },
      },
    });

    expect(recorded).toEqual([
      { dispatchId: goneRow.id, outcome: "rejected_permanent", errorCode: "410" },
    ]);
    expect(metrics.dead_letter).toBe(1);
    expect(metrics.failed_sends).toBe(1);
  });

  it("survives a record failure: lane aborts, metrics report it, invocation still returns", async () => {
    const rows = [row(), row()];
    const { callRpc } = fakeRpc([rows]);
    callRpc.mockImplementation(async (name: string) => {
      if (name === "recover_expired_alert_dispatch_leases_v18") return 0;
      if (name === "lease_alert_dispatches_v18") return rows.length ? rows.splice(0, 2) : [];
      throw new Error("record RPC unavailable");
    });

    const metrics = await runDispatcherSweep({
      invocationId: "edge:test-record-failure",
      callRpc,
      adapters: { twilio_whatsapp: acceptAll },
      config: { maxConcurrentSends: 2 },
    });

    // Both lanes hit the record failure; nothing was recorded, nothing was
    // lost — the rows stay leased and expire into delivery_unknown.
    expect(metrics.record_failures).toBe(2);
    expect(metrics.processed).toBe(0);
    expect(metrics.accepted).toBe(0);
  });

  it("uses the invocation id as the lease worker identity", async () => {
    const { callRpc, leaseWorkerIds } = fakeRpc([[row()]]);
    await runDispatcherSweep({
      invocationId: "edge:worker-identity",
      callRpc,
      adapters: { twilio_whatsapp: acceptAll },
    });
    expect(leaseWorkerIds).toEqual(["edge:worker-identity"]);
  });

  it("keeps the documented default budget", () => {
    expect(DEFAULT_DISPATCHER_CONFIG).toEqual({
      batchSize: 20,
      maxConcurrentSends: 5,
      softDeadlineMs: 20_000,
      leaseSeconds: 60,
    });
  });
});
