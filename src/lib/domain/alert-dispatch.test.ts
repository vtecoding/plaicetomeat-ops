import { describe, expect, it, vi } from "vitest";

import {
  MAX_ALERT_DISPATCH_ATTEMPTS,
  boundDispatchBatch,
  dispatchRetryDelaySeconds,
  fieldProofSucceeded,
  mergeAlertBranchSchedules,
  processLeasedAlertDispatches,
  type LeasedAlertDispatch,
} from "./alert-dispatch";

function leasedRow(overrides: Partial<LeasedAlertDispatch> = {}): LeasedAlertDispatch {
  return {
    id: "dispatch-1",
    kind: "critical_alert",
    channel: "twilio_whatsapp",
    device_id: null,
    target: "+447700900001",
    dispatch_key: "critical-alert:1",
    priority: 100,
    attempt_count: 1,
    payload: { message: "Help" },
    ...overrides,
  };
}

describe("owner alert dispatch contract", () => {
  it("bounds every sweep and the attempt-relative retry schedule ends in dead-letter", () => {
    expect(boundDispatchBatch(0)).toBe(1);
    expect(boundDispatchBatch(500)).toBe(25);
    expect(dispatchRetryDelaySeconds(1)).toBe(0);
    expect(dispatchRetryDelaySeconds(2)).toBe(15);
    expect(dispatchRetryDelaySeconds(3)).toBe(30);
    expect(dispatchRetryDelaySeconds(4)).toBe(60);
    expect(dispatchRetryDelaySeconds(5)).toBe(120);
    expect(dispatchRetryDelaySeconds(6)).toBe(240);
    expect(dispatchRetryDelaySeconds(MAX_ALERT_DISPATCH_ATTEMPTS + 1)).toBeNull();
  });

  it("fails field proof whenever any claimed dispatch is not provider-accepted", () => {
    expect(fieldProofSucceeded({ claimed: 2, accepted: 2 })).toBe(true);
    expect(fieldProofSucceeded({ claimed: 2, accepted: 1 })).toBe(false);
    expect(fieldProofSucceeded({ claimed: 1, accepted: 0 })).toBe(false);
    expect(fieldProofSucceeded({ claimed: 0, accepted: 0 })).toBe(false);
  });

  it("schedules every branch even when Owner Away settings were never saved", () => {
    expect(
      mergeAlertBranchSchedules(
        [
          { id: "branch-with-settings", timezone: "America/Los_Angeles" },
          { id: "branch-without-settings", timezone: null },
        ],
        [
          {
            branch_id: "branch-with-settings",
            summary_time: "08:15",
            owner_contact: "+447700900001",
          },
        ],
      ),
    ).toEqual([
      {
        branchId: "branch-with-settings",
        timezone: "America/Los_Angeles",
        summaryTime: "08:15",
        ownerContact: "+447700900001",
      },
      {
        branchId: "branch-without-settings",
        timezone: "Europe/London",
        summaryTime: "19:00",
        ownerContact: "",
      },
    ]);
  });

  it("records an unconfigured channel as skipped without touching the provider", async () => {
    const send = vi.fn();
    const recorded: string[] = [];
    const totals = await processLeasedAlertDispatches({
      rows: [leasedRow({ target: "" })],
      channelConfigured: (row) => Boolean(row.target.trim()),
      disabledReason: "CHANNEL_DISABLED",
      send,
      record: async (_id, result) => {
        recorded.push(`${result.outcome}:${result.errorCode}`);
      },
      classifySendError: () => ({
        message: "provider",
        outcome: "ambiguous",
        errorCode: null,
        invalidateDevice: false,
      }),
    });
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toEqual(["skipped:CHANNEL_DISABLED"]);
    expect(totals).toEqual({ claimed: 1, accepted: 0, failed: 0, skipped: 1 });
  });

  it("classifies provider failures into the recorded outcome, preserving device invalidation", async () => {
    const recorded: Array<{ outcome: string; invalidateDevice: boolean }> = [];
    const totals = await processLeasedAlertDispatches({
      rows: [leasedRow()],
      channelConfigured: () => true,
      disabledReason: "CHANNEL_DISABLED",
      send: async () => {
        throw new Error("410 subscription gone");
      },
      record: async (_id, result) => {
        recorded.push({ outcome: result.outcome, invalidateDevice: result.invalidateDevice });
      },
      classifySendError: () => ({
        message: "subscription gone",
        outcome: "rejected_permanent",
        errorCode: "410",
        invalidateDevice: true,
      }),
    });
    expect(recorded).toEqual([{ outcome: "rejected_permanent", invalidateDevice: true }]);
    expect(totals.failed).toBe(1);
  });

  it("never rewrites provider acceptance as a failed send when result recording fails", async () => {
    const outcomes: string[] = [];
    await expect(
      processLeasedAlertDispatches({
        rows: [leasedRow({ id: "dispatch-2", kind: "daily_digest", dispatch_key: "digest:2" })],
        channelConfigured: () => true,
        disabledReason: "CHANNEL_DISABLED",
        send: async () => ({ providerMessageId: "SM1", providerStatusCode: "201" }),
        record: async (_id, result) => {
          outcomes.push(result.outcome);
          throw new Error("result RPC unavailable");
        },
        classifySendError: () => ({
          message: "provider",
          outcome: "ambiguous",
          errorCode: null,
          invalidateDevice: false,
        }),
      }),
    ).rejects.toThrow("result RPC unavailable");
    // The dispatch stays leased; the expired lease becomes delivery_unknown and
    // retries under the same dispatch identity. It is never recorded as failed.
    expect(outcomes).toEqual(["accepted"]);
  });
});
