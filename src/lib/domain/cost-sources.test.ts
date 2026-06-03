import { describe, expect, it } from "vitest";

import {
  buildWeightedBatchCostMap,
  getCostPolicySummary,
  resolveInventoryCost,
  resolveMarginCost,
  resolvePurchasingCost,
} from "./cost-sources";

describe("cost source policy", () => {
  it("prefers committed product cost for margin", () => {
    expect(resolveMarginCost(6.38, 7.02)).toEqual({ value: 6.38, source: "product_cost" });
  });

  it("falls back to weighted batch cost for purchasing when product cost is missing", () => {
    expect(resolvePurchasingCost(7.02, null)).toEqual({ value: 7.02, source: "weighted_batch_cost" });
  });

  it("keeps inventory cost on the batch itself", () => {
    expect(resolveInventoryCost(7.02)).toEqual({ value: 7.02, source: "batch_cost" });
  });

  it("builds a weighted batch average per product", () => {
    const map = buildWeightedBatchCostMap([
      { productId: "lamb", costPerKg: 6, remainingWeightKg: 4, status: "active" },
      { productId: "lamb", costPerKg: 8, remainingWeightKg: 2, status: "active" },
      { productId: "lamb", costPerKg: 99, remainingWeightKg: 1, status: "depleted" },
    ]);

    expect(map.get("lamb")).toBe(6.67);
  });

  it("documents the cost policy in plain English", () => {
    expect(getCostPolicySummary()).toEqual([
      {
        context: "Margin",
        winner: "Current product cost",
        fallback: "average stock cost",
        note: "Committed product cost wins for pricing and gross margin.",
      },
      {
        context: "Purchasing",
        winner: "average stock cost",
        fallback: "current product cost",
        note: "Stock planning values on-hand inventory first, then falls back to committed product cost.",
      },
      {
        context: "Inventory",
        winner: "stock item cost",
        fallback: "none",
        note: "Each batch keeps its own received cost and never borrows from another product.",
      },
      {
        context: "Dashboard",
        winner: "current product cost",
        fallback: "average stock cost",
        note: "Dashboard profit uses the same committed product cost that powers margin reporting.",
      },
    ]);
  });
});
