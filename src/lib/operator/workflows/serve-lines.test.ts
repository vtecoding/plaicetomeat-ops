import { describe, expect, it } from "vitest";

import {
  resolveServeLines,
  serveRepairDecision,
  serveSubtotal,
  type ServeProductLite,
} from "@/lib/operator/workflows/serve-lines";

function kgProduct(id: string, price: number): ServeProductLite {
  return { id, name: `Product ${id}`, unit_type: "kg", price_per_unit: price };
}

function eachProduct(id: string, price: number): ServeProductLite {
  return { id, name: `Whole ${id}`, unit_type: "each", price_per_unit: price };
}

function mapOf(...products: ServeProductLite[]) {
  return new Map(products.map((p) => [p.id, p]));
}

describe("resolveServeLines", () => {
  // F5 / T3
  it("rejects a custom line with no price", () => {
    const res = resolveServeLines([{ productId: null, name: "Other", quantityKg: 0.5, priceGbp: null }], mapOf());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/price/i);
  });

  it("rejects a custom line priced at £0", () => {
    const res = resolveServeLines([{ productId: null, name: "Other", quantityKg: 0.5, priceGbp: 0 }], mapOf());
    expect(res.ok).toBe(false);
  });

  it("rejects a custom line with a negative price", () => {
    const res = resolveServeLines([{ productId: null, name: "Other", quantityKg: 0.5, priceGbp: -3 }], mapOf());
    expect(res.ok).toBe(false);
  });

  it("rejects a custom line with a non-numeric / NaN price", () => {
    const res = resolveServeLines([{ productId: null, name: "Other", quantityKg: 0.5, priceGbp: Number.NaN }], mapOf());
    expect(res.ok).toBe(false);
  });

  it("rejects an absurd custom price above the cap", () => {
    const res = resolveServeLines([{ productId: null, name: "Other", quantityKg: 0.5, priceGbp: 999999 }], mapOf());
    expect(res.ok).toBe(false);
  });

  it("accepts a valid custom line and records the entered pounds as the line total", () => {
    const res = resolveServeLines([{ productId: null, name: "Goat curry cut", quantityKg: 0.5, priceGbp: 7.5 }], mapOf());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines[0].total).toBe(7.5);
      expect(res.lines[0].needsCheck).toBe(true);
      // quantity * unit_price stays consistent with the total
      expect(Math.round(res.lines[0].quantity * res.lines[0].price * 100) / 100).toBe(7.5);
    }
  });

  // F6 / T4
  it("rejects an each product in the weight flow", () => {
    const res = resolveServeLines(
      [{ productId: "whole", name: null, quantityKg: 1, priceGbp: null }],
      mapOf(eachProduct("whole", 6)),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/each/i);
  });

  it("prices a kg product per kg and flags no owner check", () => {
    const res = resolveServeLines(
      [{ productId: "breast", name: null, quantityKg: 2, priceGbp: null }],
      mapOf(kgProduct("breast", 9)),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines[0].total).toBe(18);
      expect(res.lines[0].unit).toBe("kg");
      expect(res.lines[0].needsCheck).toBe(false);
    }
  });
});

// N1 regression: a first attempt can persist the order header and fail before the
// item rows land. The retry must never collect a header-only order (money recorded
// with no lines and no depletion) and must never silently change money.
describe("serveRepairDecision", () => {
  const base = { persistedSubtotal: 18, resolvedSubtotal: 18 };

  it("proceeds when the order already has item rows", () => {
    expect(serveRepairDecision({ ...base, status: "incoming", itemCount: 2 })).toBe("proceed");
  });

  it("proceeds when the order is already terminal (collected/cancelled)", () => {
    expect(serveRepairDecision({ ...base, status: "collected", itemCount: 0 })).toBe("proceed");
    expect(serveRepairDecision({ ...base, status: "cancelled", itemCount: 0 })).toBe("proceed");
  });

  it("repairs a header-only order when the retry resolves to the same subtotal", () => {
    expect(serveRepairDecision({ ...base, status: "incoming", itemCount: 0 })).toBe("insert-items");
  });

  it("tolerates float representation but not real money differences", () => {
    expect(
      serveRepairDecision({ status: "incoming", itemCount: 0, persistedSubtotal: 18.0000001, resolvedSubtotal: 18 }),
    ).toBe("insert-items");
  });

  it("escalates a header-only order when the retry's money differs", () => {
    expect(
      serveRepairDecision({ status: "incoming", itemCount: 0, persistedSubtotal: 18, resolvedSubtotal: 17.5 }),
    ).toBe("escalate");
  });

  it("escalates when the persisted subtotal is unreadable", () => {
    expect(
      serveRepairDecision({ status: "incoming", itemCount: 0, persistedSubtotal: Number.NaN, resolvedSubtotal: 18 }),
    ).toBe("escalate");
  });
});

describe("serveSubtotal", () => {
  it("sums line totals to clean 2dp money", () => {
    const res = resolveServeLines(
      [
        { productId: "breast", name: null, quantityKg: 0.3, priceGbp: null },
        { productId: null, name: "Other", quantityKg: 0.5, priceGbp: 7.5 },
      ],
      mapOf(kgProduct("breast", 9.99)),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(serveSubtotal(res.lines)).toBe(10.5);
  });
});
