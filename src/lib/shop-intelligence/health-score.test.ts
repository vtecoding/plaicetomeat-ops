import { describe, expect, it } from "vitest";

import { buildHealthScore } from "./health-score";
import { makeBatch, makeSnapshot } from "./test-helpers";

describe("buildHealthScore (V8.8)", () => {
  it("scores a healthy shop strongly with six categories", () => {
    const health = buildHealthScore(makeSnapshot());
    expect(health.categories).toHaveLength(6);
    expect(health.score).not.toBeNull();
    expect(health.band).toBe("strong");
    expect(health.strong).toContain("Cost coverage");
  });

  it("computes cost coverage as the share of products with a cost", () => {
    const health = buildHealthScore(
      makeSnapshot({ products: { total: 10, zeroPrice: 0, missingCost: 4, missingStockInfo: 0, activeSellingNoCost: 0 } }),
    );
    const cost = health.categories.find((c) => c.key === "cost_coverage");
    expect(cost?.score).toBe(60); // 6/10 covered
  });

  it("marks a category unknown rather than faking a number", () => {
    const health = buildHealthScore(
      makeSnapshot({ compliance: { rows: [], expired: 0, expiringSoon: 0, missing: 0, status: "Unconfigured" } }),
    );
    const compliance = health.categories.find((c) => c.key === "compliance_readiness");
    expect(compliance?.band).toBe("unknown");
  });

  it("returns a null overall score when nothing can be judged", () => {
    const blank = makeSnapshot({
      orders: { today: 0, awaitingPrep: 0, ready: 0 },
      stock: { batchesExpiringWithin3Days: 0, valueAtRisk: 0, activeBatchCount: 0, daysSinceLastStockActivity: null },
      products: { total: 0, zeroPrice: 0, missingCost: 0, missingStockInfo: 0, activeSellingNoCost: 0 },
      compliance: { rows: [], expired: 0, expiringSoon: 0, missing: 0, status: "Unconfigured" },
    });
    const health = buildHealthScore(blank);
    expect(health.score).toBeNull();
    expect(health.band).toBe("unknown");
  });

  it("drops stock accuracy when records contradict the fridge", () => {
    const health = buildHealthScore(
      makeSnapshot({
        batches: [makeBatch({ status: "active", remainingWeightKg: 3, daysToExpiry: -3 })],
      }),
    );
    const stock = health.categories.find((c) => c.key === "stock_accuracy");
    expect(stock?.score).toBeLessThan(80);
  });

  it("penalises waste tracking when nothing is logged", () => {
    const health = buildHealthScore(
      makeSnapshot({ waste: { weekValue: 0, monthValue: 0, byProduct: [], byReason: [], eventsThisWeek: 0 } }),
    );
    const waste = health.categories.find((c) => c.key === "waste_tracking");
    expect(waste?.band).toBe("needs_attention");
  });
});
