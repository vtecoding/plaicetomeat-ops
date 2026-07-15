import { describe, expect, it, vi } from "vitest";
import { CHANNEL_DISABLED } from "../domain/alert-dispatcher-core";
import type { LeasedAlertDispatch } from "../domain/alert-dispatch";
import { createWebPushChannelAdapter, resolveWebPushConfig } from "./web-push-channel";

const config = { publicKey: "public", privateKey: "private", subject: "mailto:ops@example.test" };
const subscription = { endpoint: "https://push.example.test/id", keys: { auth: "auth", p256dh: "key" } };
const row: LeasedAlertDispatch = {
  id: "11111111-1111-4111-8111-111111111111", kind: "critical_alert", channel: "web_push",
  device_id: "22222222-2222-4222-8222-222222222222", target: "", dispatch_key: "key", priority: 100, attempt_count: 1,
  payload: { schemaVersion: 1, messageType: "owner_alert", dispatchId: "11111111-1111-4111-8111-111111111111",
    alertId: "33333333-3333-4333-8333-333333333333", alertKind: "inventory_shortfall", severity: "critical",
    title: "Urgent shop alert", body: "Open PTM to review this alert.", route: "/admin/today", createdAt: "2026-07-15T17:00:00.000Z" },
};

function adapter(statusCode = 201) {
  return createWebPushChannelAdapter({ config, loadSubscription: async () => subscription, sendNotification: vi.fn(async () => ({ statusCode })) });
}

describe("Web Push adapter", () => {
  it("sends an explicit versioned payload and reports genuine acceptance", async () => {
    const sendNotification = vi.fn(async (sentSubscription: typeof subscription, sentPayload: string) => {
      expect(sentSubscription).toEqual(subscription);
      expect(sentPayload).toContain('"schemaVersion":1');
      return { statusCode: 201 };
    });
    const a = createWebPushChannelAdapter({ config, loadSubscription: async () => subscription, sendNotification });
    await expect(a.send(row)).resolves.toEqual({ providerMessageId: null, providerStatusCode: "201" });
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ schemaVersion: 1, dispatchId: row.id });
  });
  it.each([
    [404, "rejected_permanent", "PUSH_SUBSCRIPTION_INVALID", true],
    [410, "rejected_permanent", "PUSH_SUBSCRIPTION_INVALID", true],
    [401, "rejected_permanent", CHANNEL_DISABLED, false],
    [403, "rejected_permanent", CHANNEL_DISABLED, false],
    [429, "failed_transient", "PUSH_RATE_LIMITED", false],
    [500, "ambiguous", "PUSH_PROVIDER_500", false],
  ])("classifies status %i", async (statusCode, outcome, errorCode, invalidateDevice) => {
    const a = createWebPushChannelAdapter({ config, loadSubscription: async () => subscription,
      sendNotification: async () => { throw { statusCode }; } });
    await expect(a.send(row)).rejects.toMatchObject({ outcome, errorCode, invalidateDevice });
  });
  it("classifies network failure as ambiguous", async () => {
    const a = createWebPushChannelAdapter({ config, loadSubscription: async () => subscription,
      sendNotification: async () => { throw new Error("timeout"); } });
    await expect(a.send(row)).rejects.toMatchObject({ outcome: "ambiguous", errorCode: "PUSH_TRANSPORT_FAILED" });
  });
  it("invalidates malformed stored subscriptions", async () => {
    const a = createWebPushChannelAdapter({ config, loadSubscription: async () => ({ ...subscription, endpoint: "http://bad" }), sendNotification: async () => ({}) });
    await expect(a.send(row)).rejects.toMatchObject({ outcome: "rejected_permanent", invalidateDevice: true });
  });
  it("is disabled when VAPID configuration is missing or the subject is invalid", () => {
    expect(adapter().isConfigured(row)).toBe(true);
    const missing = createWebPushChannelAdapter({ config: resolveWebPushConfig({}), loadSubscription: async () => subscription, sendNotification: async () => ({}) });
    expect(missing.isConfigured(row)).toBe(false);
  });
});
