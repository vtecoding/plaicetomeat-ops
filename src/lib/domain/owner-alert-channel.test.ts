import { describe, expect, it, vi } from "vitest";

import {
  localBusinessClock,
  ownerAlertChannelConfigured,
  resolveOwnerAlertChannel,
  sendOwnerAlertViaTwilio,
} from "./owner-alert-channel";

describe("canonical owner-alert channel adapter", () => {
  it("stays disabled until the explicit switch and all provider fields exist", () => {
    expect(ownerAlertChannelConfigured(resolveOwnerAlertChannel({ TWILIO_ACCOUNT_SID: "sid" }))).toBe(false);
    expect(ownerAlertChannelConfigured(resolveOwnerAlertChannel({
      OWNER_ALERT_CHANNEL_ENABLED: "true", OWNER_ALERT_DUPLICATE_DELIVERY_ACCEPTED: "true",
      TWILIO_ACCOUNT_SID: "sid", TWILIO_AUTH_TOKEN: "token", TWILIO_OWNER_FROM: "+1",
    }))).toBe(true);
  });

  it("uses branch-local time across the BST transition", () => {
    expect(localBusinessClock(new Date("2026-03-29T00:30:00Z"), "Europe/London")).toEqual({ businessDate: "2026-03-29", minuteOfDay: 30 });
    expect(localBusinessClock(new Date("2026-03-29T01:30:00Z"), "Europe/London")).toEqual({ businessDate: "2026-03-29", minuteOfDay: 150 });
  });

  it("does not pretend Twilio accepts an undocumented idempotency header", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      capturedInit = init;
      return new Response('{"sid":"SM1"}', { status: 201 });
    });
    const result = await sendOwnerAlertViaTwilio({
      config: { enabled: true, duplicateDeliveryAccepted: true, accountSid: "AC1", authToken: "secret", from: "+15550001" },
      target: "+447700900000", message: "Test", fetcher,
    });
    expect(capturedInit?.headers).not.toHaveProperty("Idempotency-Key");
    expect(capturedInit?.headers).not.toHaveProperty("I-Twilio-Idempotency-Token");
    expect(result).toEqual({ providerMessageId: "SM1", providerStatusCode: "201" });
  });

  it("classifies transport failures as ambiguous and provider verdicts by status", async () => {
    const config = { enabled: true, duplicateDeliveryAccepted: true, accountSid: "AC1", authToken: "secret", from: "+15550001" };
    const failWith = (status: number) =>
      sendOwnerAlertViaTwilio({
        config,
        target: "+447700900000",
        message: "Test",
        fetcher: async () => new Response("{}", { status }),
      });

    await expect(
      sendOwnerAlertViaTwilio({
        config,
        target: "+447700900000",
        message: "Test",
        fetcher: async () => {
          throw new Error("socket hang up");
        },
      }),
    ).rejects.toMatchObject({ outcome: "ambiguous", errorCode: "TRANSPORT_FAILED" });
    await expect(failWith(429)).rejects.toMatchObject({ outcome: "failed_transient" });
    await expect(failWith(503)).rejects.toMatchObject({ outcome: "ambiguous" });
    await expect(failWith(400)).rejects.toMatchObject({ outcome: "rejected_permanent" });
  });
});
