import { describe, expect, it, vi } from "vitest";

import {
  boundDispatchBatch,
  deliverWithStableKey,
  dispatchBackoffSeconds,
  fieldProofSucceeded,
  mergeAlertBranchSchedules,
  processClaimedAlertDispatches,
} from "./alert-dispatch";

describe("owner alert dispatch contract", () => {
  it("bounds every sweep and makes the fifth failure terminal", () => {
    expect(boundDispatchBatch(0)).toBe(1);
    expect(boundDispatchBatch(500)).toBe(25);
    expect(dispatchBackoffSeconds(1)).toBe(30);
    expect(dispatchBackoffSeconds(4)).toBe(240);
    expect(dispatchBackoffSeconds(5)).toBeNull();
  });

  it("fails field proof whenever any claimed dispatch is not confirmed sent", () => {
    expect(fieldProofSucceeded({ claimed: 2, sent: 2 })).toBe(true);
    expect(fieldProofSucceeded({ claimed: 2, sent: 1 })).toBe(false);
    expect(fieldProofSucceeded({ claimed: 1, sent: 0 })).toBe(false);
    expect(fieldProofSucceeded({ claimed: 0, sent: 0 })).toBe(false);
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

  it("does not double-send after a crash between provider success and recording", async () => {
    const providerOperations = new Map<string, string>();
    let physicalSends = 0;
    const sender = vi.fn(async (input: { providerIdempotencyKey: string }) => {
      let providerResponse = providerOperations.get(input.providerIdempotencyKey);
      if (!providerResponse) {
        physicalSends += 1;
        providerResponse = `message-${physicalSends}`;
        providerOperations.set(input.providerIdempotencyKey, providerResponse);
      }
      return { providerResponse };
    });
    const envelope = {
      id: "dispatch-1",
      channel: "idempotent_test_provider",
      target: "+447700900000",
      providerIdempotencyKey: "critical-alert:stable",
      message: "Fridge needs help.",
    };

    await expect(
      deliverWithStableKey(envelope, sender, async () => {
        throw new Error("database unavailable after send");
      }),
    ).rejects.toThrow("database unavailable");

    const recorded: string[] = [];
    await deliverWithStableKey(envelope, sender, async (result) => {
      recorded.push(result.providerResponse ?? "");
    });

    expect(sender).toHaveBeenCalledTimes(2);
    expect(physicalSends).toBe(1);
    expect(recorded).toEqual(["message-1"]);
  });

  it("never misclassifies a send-boundary database failure as a provider attempt", async () => {
    const send = vi.fn();
    const record = vi.fn();
    await expect(
      processClaimedAlertDispatches({
        rows: [{
          id: "dispatch-1",
          kind: "critical_alert",
          channel: "test",
          target: "+447700900001",
          provider_idempotency_key: "critical-alert:1",
          payload: { message: "Help" },
        }],
        channelConfigured: true,
        disabledReason: "disabled",
        begin: async () => { throw new Error("begin RPC unavailable"); },
        send,
        record,
        classifySendError: () => ({ message: "provider", retryable: false, ambiguous: true }),
      }),
    ).rejects.toThrow("begin RPC unavailable");
    expect(send).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("never rewrites provider acceptance as a failed send when result recording fails", async () => {
    const statuses: string[] = [];
    await expect(
      processClaimedAlertDispatches({
        rows: [{
          id: "dispatch-2",
          kind: "daily_digest",
          channel: "test",
          target: "+447700900001",
          provider_idempotency_key: "digest:2",
          payload: { message: "Digest" },
        }],
        channelConfigured: true,
        disabledReason: "disabled",
        begin: async () => undefined,
        send: async () => ({ providerResponse: "accepted" }),
        record: async (_id, result) => {
          statuses.push(result.status);
          throw new Error("result RPC unavailable");
        },
        classifySendError: () => ({ message: "provider", retryable: false, ambiguous: true }),
      }),
    ).rejects.toThrow("result RPC unavailable");
    expect(statuses).toEqual(["sent"]);
  });
});
