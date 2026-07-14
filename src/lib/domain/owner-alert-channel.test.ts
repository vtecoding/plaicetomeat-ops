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
      OWNER_ALERT_CHANNEL_ENABLED: "true", OWNER_ALERT_TWILIO_AT_MOST_ONCE_ACCEPTED: "true",
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
    await sendOwnerAlertViaTwilio({
      config: { enabled: true, atMostOnceAccepted: true, accountSid: "AC1", authToken: "secret", from: "+15550001" },
      target: "+447700900000", message: "Test", providerIdempotencyKey: "stable-key", fetcher,
    });
    expect(capturedInit?.headers).not.toHaveProperty("Idempotency-Key");
    expect(capturedInit?.headers).not.toHaveProperty("I-Twilio-Idempotency-Token");
  });
});
