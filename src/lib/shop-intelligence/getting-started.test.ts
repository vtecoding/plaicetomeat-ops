import { describe, expect, it } from "vitest";

import { buildGettingStarted } from "./getting-started";
import { makeSnapshot } from "./test-helpers";

describe("buildGettingStarted (first-run teaching)", () => {
  it("shows all four foundations as not-done for a brand-new shop", () => {
    const blank = makeSnapshot({
      products: { total: 0, zeroPrice: 0, missingCost: 0, missingStockInfo: 0, activeSellingNoCost: 0 },
      stock: { batchesExpiringWithin3Days: 0, valueAtRisk: 0, activeBatchCount: 0, daysSinceLastStockActivity: null },
      compliance: { rows: [], expired: 0, expiringSoon: 0, missing: 0, status: "Unconfigured" },
    });
    const start = buildGettingStarted(blank);
    expect(start.show).toBe(true);
    expect(start.doneCount).toBe(0);
    expect(start.steps.every((step) => !step.done)).toBe(true);
    // Every step teaches the *why*, in plain English.
    expect(start.steps.every((step) => step.why.length > 0)).toBe(true);
  });

  it("ticks foundations that are already in place", () => {
    const partial = makeSnapshot({
      products: { total: 5, zeroPrice: 0, missingCost: 5, missingStockInfo: 5, activeSellingNoCost: 0 },
      stock: { batchesExpiringWithin3Days: 0, valueAtRisk: 0, activeBatchCount: 0, daysSinceLastStockActivity: null },
      compliance: { rows: [], expired: 0, expiringSoon: 0, missing: 0, status: "Unconfigured" },
    });
    const start = buildGettingStarted(partial);
    expect(start.steps.find((step) => step.id === "list-products")?.done).toBe(true);
    expect(start.steps.find((step) => step.id === "add-costs")?.done).toBe(false); // missing costs
    expect(start.show).toBe(true);
  });

  it("hides itself once the shop is fully set up", () => {
    // makeSnapshot is a healthy, established shop: products, costs, stock and certs.
    const start = buildGettingStarted(makeSnapshot());
    expect(start.show).toBe(false);
    expect(start.doneCount).toBe(start.totalCount);
  });
});
