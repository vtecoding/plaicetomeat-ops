import { describe, expect, it } from "vitest";

import {
  getSmsBadgeState,
  redactPhone,
  renderReadySmsTemplate,
  resolveSmsMode,
  shouldSendReadySms,
  validateReadySmsTemplate,
} from "./sms";

describe("ready SMS", () => {
  it("renders branch configurable placeholders", () => {
    expect(
      renderReadySmsTemplate({
        template: "Order {order_ref} is ready at {address}.",
        orderRef: "PTM-2026-00042",
        address: "426 Birmingham Road",
      }),
    ).toBe("Order PTM-2026-00042 is ready at 426 Birmingham Road.");
  });

  it("validates supported placeholders", () => {
    expect(validateReadySmsTemplate("Order {order_ref} is ready at {address}.")).toEqual({ ok: true, unsupported: [] });
    expect(validateReadySmsTemplate("Hi {customer_name}, order {order_ref} is ready.")).toEqual({
      ok: false,
      unsupported: ["customer_name"],
    });
  });

  it("blocks duplicate sends once ready_sms_sent_at is set", () => {
    expect(shouldSendReadySms(null)).toBe(true);
    expect(shouldSendReadySms("2026-05-29T12:00:00.000Z")).toBe(false);
  });
});

describe("resolveSmsMode", () => {
  it("is disabled when no provider is configured", () => {
    expect(resolveSmsMode({ providerConfigured: false, sendingEnabled: true, isTestOrder: false })).toBe("disabled");
  });

  it("is disabled when sending is turned off, even with a provider", () => {
    expect(resolveSmsMode({ providerConfigured: true, sendingEnabled: false, isTestOrder: false })).toBe("disabled");
  });

  it("is dry_run for a test order even when fully configured", () => {
    expect(resolveSmsMode({ providerConfigured: true, sendingEnabled: true, isTestOrder: true })).toBe("dry_run");
  });

  it("is live only when configured, enabled, and not a test order", () => {
    expect(resolveSmsMode({ providerConfigured: true, sendingEnabled: true, isTestOrder: false })).toBe("live");
  });
});

describe("redactPhone", () => {
  it("keeps only the last three digits", () => {
    expect(redactPhone("+447700900123")).toBe("*********123");
  });
  it("handles missing input", () => {
    expect(redactPhone(null)).toBe("unknown");
  });
});

describe("getSmsBadgeState", () => {
  it("prefers the explicit sms_status when present", () => {
    expect(getSmsBadgeState(null, null, "dry_run")).toBe("dry_run");
    expect(getSmsBadgeState(null, "Twilio 500", "failed")).toBe("failed");
  });
  it("falls back to legacy fields when sms_status is absent", () => {
    expect(getSmsBadgeState("2026-05-29T12:00:00Z", null, null)).toBe("sent");
    expect(getSmsBadgeState(null, "boom", null)).toBe("failed");
    expect(getSmsBadgeState(null, null, null)).toBe("not_required");
  });
});
