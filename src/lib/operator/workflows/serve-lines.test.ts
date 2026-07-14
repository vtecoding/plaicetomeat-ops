import { describe, expect, it } from "vitest";

import {
  resolveServeLines,
  serveRepairDecision,
  serveSubtotal,
  type ServeProductLite,
} from "@/lib/operator/workflows/serve-lines";

function product(id: string, unit: ServeProductLite["unit_type"], price: number): ServeProductLite {
  return { id, name: `Product ${id}`, unit_type: unit, price_per_unit: price };
}

function mapOf(...products: ServeProductLite[]) {
  return new Map(products.map((item) => [item.id, item]));
}

describe("resolveServeLines", () => {
  it.each([null, 0, -3, Number.NaN, 999999])("rejects an invalid custom price (%s)", (priceGbp) => {
    const result = resolveServeLines([{ productId: null, name: "Other", quantity: 0.5, priceGbp }], mapOf());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/price/i);
  });

  it("accepts a custom weighted line and treats entered pounds as the line total", () => {
    const result = resolveServeLines(
      [{ productId: null, name: "Goat curry cut", quantity: 0.5, priceGbp: 7.5 }],
      mapOf(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0]).toMatchObject({ total: 7.5, quantity: 0.5, unit: "kg", needsCheck: true });
      expect(Math.round(result.lines[0].quantity * result.lines[0].price * 100) / 100).toBe(7.5);
    }
  });

  it("never turns a missing, foreign, or unavailable catalogue id into a custom sale", () => {
    const result = resolveServeLines(
      [{ productId: "catalogue-id", name: "Unavailable item", quantity: 1, priceGbp: 12 }],
      mapOf(),
    );
    expect(result).toEqual({ ok: false, message: "That item is no longer available." });
  });

  it("prices kg, each, and box catalogue lines as quantity times current catalogue price", () => {
    const result = resolveServeLines(
      [
        { productId: "breast", name: null, quantity: 0.5, priceGbp: null },
        { productId: "whole", name: null, quantity: 12, priceGbp: null },
        { productId: "box", name: null, quantity: 2, priceGbp: null },
      ],
      mapOf(product("breast", "kg", 9), product("whole", "each", 6.5), product("box", "box", 25)),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines.map((line) => [line.unit, line.total])).toEqual([
        ["kg", 4.5],
        ["each", 78],
        ["box", 50],
      ]);
      expect(serveSubtotal(result.lines)).toBe(132.5);
    }
  });

  it.each([
    ["each", 0],
    ["each", 1.5],
    ["each", 100],
    ["box", -1],
    ["box", 99.1],
  ] as const)("rejects %s quantity %s outside the integer 1-99 contract", (unit, quantity) => {
    const result = resolveServeLines(
      [{ productId: "counted", name: null, quantity, priceGbp: null }],
      mapOf(product("counted", unit, 5)),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("whole number");
  });

  it.each([0, -1, 50.001, Number.NaN])("rejects invalid kg quantity %s", (quantity) => {
    const result = resolveServeLines(
      [{ productId: "kg", name: null, quantity, priceGbp: null }],
      mapOf(product("kg", "kg", 9)),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/weight/i);
  });
});

describe("serveRepairDecision", () => {
  const base = { persistedSubtotal: 18, resolvedSubtotal: 18 };

  it("proceeds when the order already has item rows", () => {
    expect(serveRepairDecision({ ...base, status: "incoming", itemCount: 2 })).toBe("proceed");
  });

  it("proceeds when the order is already terminal", () => {
    expect(serveRepairDecision({ ...base, status: "collected", itemCount: 0 })).toBe("proceed");
    expect(serveRepairDecision({ ...base, status: "cancelled", itemCount: 0 })).toBe("proceed");
  });

  it("repairs a same-total header-only retry", () => {
    expect(serveRepairDecision({ ...base, status: "incoming", itemCount: 0 })).toBe("insert-items");
    expect(serveRepairDecision({ status: "incoming", itemCount: 0, persistedSubtotal: 18.0000001, resolvedSubtotal: 18 })).toBe("insert-items");
  });

  it("escalates a header-only retry if money differs or is unreadable", () => {
    expect(serveRepairDecision({ status: "incoming", itemCount: 0, persistedSubtotal: 18, resolvedSubtotal: 17.5 })).toBe("escalate");
    expect(serveRepairDecision({ status: "incoming", itemCount: 0, persistedSubtotal: Number.NaN, resolvedSubtotal: 18 })).toBe("escalate");
  });
});
