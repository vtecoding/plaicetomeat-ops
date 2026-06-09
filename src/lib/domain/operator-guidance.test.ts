import { describe, expect, it } from "vitest";

import { buildOperatorGuidanceCards, buildProductHealthSignals } from "./operator-guidance";

describe("operator guidance", () => {
  it("turns confidence loss into a count-today action without exposing the score", () => {
    const cards = buildOperatorGuidanceCards({
      inventoryTruth: [
        {
          productId: "chicken",
          productName: "Chicken Breast",
          operatorSignal: "count_today",
          internalReasons: ["cache_mismatch", "repeated_shortfall"],
        },
      ],
    });

    expect(cards[0]).toMatchObject({
      title: "Please count Chicken Breast today",
      whatHappened: "Stock keeps changing unexpectedly.",
      recommendedAction: "Count Chicken Breast today.",
      health: "Needs Attention",
    });
    expect(JSON.stringify(cards[0])).not.toContain("cache_mismatch");
    expect(JSON.stringify(cards[0])).not.toContain("score");
  });

  it("keeps purchasing guidance action-first", () => {
    const cards = buildOperatorGuidanceCards({
      purchasing: [{ kind: "order_more", productName: "Lamb Mince", confidence: "high" }],
    });

    expect(cards[0]?.title).toBe("Order Lamb Mince tomorrow");
    expect(cards[0]?.whatHappened).toBe("Lamb Mince is running low.");
  });

  it("translates short-dated stock into sell-first wording", () => {
    const cards = buildOperatorGuidanceCards({
      expiry: [{ productName: "Beef Steak", daysToExpiry: 1, valueAtRisk: 92 }],
    });

    expect(cards[0]).toMatchObject({
      title: "Sell Beef Steak first",
      recommendedAction: "Sell this first.",
      valueAtRisk: 92,
    });
  });

  it("summarises product health in three operator-safe states", () => {
    const health = buildProductHealthSignals([
      { productId: "a", productName: "Good", inventorySignal: "trusted", daysToExpiry: 6, daysUntilRunout: 7 },
      { productId: "b", productName: "Soon", inventorySignal: "count_soon", daysToExpiry: 6, daysUntilRunout: 7 },
      { productId: "c", productName: "Now", inventorySignal: "trusted", daysToExpiry: 0, daysUntilRunout: 7 },
    ]);

    expect(health.map((item) => item.status)).toEqual(["Healthy", "Check Soon", "Needs Attention"]);
  });
});
