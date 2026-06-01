import { describe, expect, it } from "vitest";

import {
  buildAuditEventPayload,
  calculateTrackedRemainingKg,
  calculateWasteValue,
  getCertificateState,
  getExpiryRisk,
} from "@/lib/domain/compliance-inventory";

describe("certificate status", () => {
  const now = new Date("2026-05-31T12:00:00.000Z");

  it("derives certificate state from active flag and expiry", () => {
    expect(getCertificateState({ certExpiry: "2026-08-31", active: false }, now)).toBe("inactive");
    expect(getCertificateState({ certExpiry: null, active: true }, now)).toBe("missing_expiry");
  });

  it("marks certificates by expiry risk", () => {
    expect(getCertificateState({ certExpiry: "2026-08-31", active: true }, now)).toBe("valid");
    expect(getCertificateState({ certExpiry: "2026-06-10", active: true }, now)).toBe("expiring_soon");
    expect(getCertificateState({ certExpiry: "2026-05-30", active: true }, now)).toBe("expired");
  });
});

describe("inventory risk helpers", () => {
  const now = new Date("2026-05-31T12:00:00.000Z");

  it("calculates expiry risk", () => {
    expect(getExpiryRisk("2026-05-30", now)).toBe("expired");
    expect(getExpiryRisk("2026-05-31", now)).toBe("expires_today");
    expect(getExpiryRisk("2026-06-03", now)).toBe("expiring_soon");
    expect(getExpiryRisk("2026-06-10", now)).toBe("ok");
  });

  it("calculates waste value and transitional tracked remaining stock", () => {
    expect(calculateWasteValue(1.25, 8)).toBe(10);
    expect(calculateTrackedRemainingKg({ receivedKg: 10, wasteKg: 1.257 })).toBe(8.743);
    expect(calculateTrackedRemainingKg({ receivedKg: 1, wasteKg: 2 })).toBe(0);
  });

  it("builds stable audit event payloads", () => {
    expect(
      buildAuditEventPayload({
        eventType: "waste_recorded",
        entityType: "inventory_batch",
        entityId: "batch-1",
        summary: "1kg waste recorded",
      }),
    ).toEqual({
      event_type: "waste_recorded",
      entity_type: "inventory_batch",
      entity_id: "batch-1",
      summary: "1kg waste recorded",
      metadata: {},
    });
  });
});
