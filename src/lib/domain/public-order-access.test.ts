import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_PUBLIC_FIELDS,
  PUBLIC_ORDER_STATUS_KEYS,
  findForbiddenFields,
  normalizeUkPhone,
  type PublicOrderStatus,
} from "./public-order-access";

describe("normalizeUkPhone (mirrors SQL public.normalize_phone)", () => {
  it("strips formatting and trunk zero", () => {
    expect(normalizeUkPhone("07123 456789")).toBe("7123456789");
    expect(normalizeUkPhone("07123-456-789")).toBe("7123456789");
    expect(normalizeUkPhone("(07123) 456789")).toBe("7123456789");
  });

  it("strips +44 / 44 country code", () => {
    expect(normalizeUkPhone("+44 7123 456789")).toBe("7123456789");
    expect(normalizeUkPhone("447123456789")).toBe("7123456789");
  });

  it("treats differently-formatted versions of one number as equal", () => {
    expect(normalizeUkPhone("+447123456789")).toBe(normalizeUkPhone("07123 456789"));
  });

  it("returns empty string when there are no digits", () => {
    expect(normalizeUkPhone("")).toBe("");
    expect(normalizeUkPhone("abc")).toBe("");
    expect(normalizeUkPhone(null)).toBe("");
    expect(normalizeUkPhone(undefined)).toBe("");
  });
});

describe("findForbiddenFields — public DTO must not leak internal fields", () => {
  const safe: PublicOrderStatus = {
    orderRef: "PTM-2026-00042",
    customerDisplayName: "Sam",
    status: "incoming",
    pickupDate: "2026-06-06",
    pickupWindowLabel: "Morning",
    items: [{ name: "Lamb chops", quantity: 1, unitType: "kg", lineTotal: 12.5 }],
    subtotal: 12.5,
    canCancel: true,
    cancellationDeadline: "2026-06-05T12:00:00Z",
  };

  it("accepts a clean safe DTO", () => {
    expect(findForbiddenFields(safe)).toEqual([]);
  });

  it("flags a leaked customer phone", () => {
    const leaked = { ...safe, customerPhone: "07123456789" };
    expect(findForbiddenFields(leaked).length).toBeGreaterThan(0);
  });

  it("flags leaked raw id / branch id / sms diagnostics", () => {
    for (const field of ["id", "branch_id", "sms_failure_reason", "customer_email", "public_access_id"]) {
      const leaked = { ...safe, [field]: "x" } as Record<string, unknown>;
      expect(findForbiddenFields(leaked), `field ${field} should be flagged`).not.toEqual([]);
    }
  });

  it("flags forbidden fields nested inside items", () => {
    const leaked = {
      ...safe,
      items: [{ name: "Lamb", quantity: 1, unitType: "kg", lineTotal: 12.5, staff_notes: "leak" }],
    };
    expect(findForbiddenFields(leaked).length).toBeGreaterThan(0);
  });

  it("flags any unexpected top-level key (allow-list is closed)", () => {
    const leaked = { ...safe, somethingNew: true };
    expect(findForbiddenFields(leaked).some((v) => v.includes("somethingNew"))).toBe(true);
  });

  it("forbidden list and allow-list never overlap", () => {
    const allow = new Set<string>(PUBLIC_ORDER_STATUS_KEYS as readonly string[]);
    for (const f of FORBIDDEN_PUBLIC_FIELDS) {
      expect(allow.has(f), `${f} must not be both allowed and forbidden`).toBe(false);
    }
  });
});
