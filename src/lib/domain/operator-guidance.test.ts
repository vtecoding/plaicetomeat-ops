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

  it("escalates a recurring-problem product from 'soon' to 'today' (Workstream B)", () => {
    // Signal arrives as the weaker count_soon, but the reasons show recurring
    // instability — the operator must still be told to count it TODAY.
    const cards = buildOperatorGuidanceCards({
      inventoryTruth: [
        {
          productId: "mince",
          productName: "Beef Mince",
          operatorSignal: "count_soon",
          internalReasons: ["repeated_shortfall"],
        },
      ],
    });

    expect(cards[0]).toMatchObject({
      title: "Please count Beef Mince today",
      whatHappened: "Stock keeps changing unexpectedly.",
      recommendedAction: "Count Beef Mince today.",
      severity: "urgent",
      health: "Needs Attention",
    });
  });

  it("suppresses an Order for a low-confidence product and shows Count instead", () => {
    // The named V14.3 bug: a product with repeated shortfalls (low inventory-truth
    // confidence) must never be told "Order tomorrow" — only "Count today".
    const cards = buildOperatorGuidanceCards({
      inventoryTruth: [
        {
          productId: "chicken",
          productName: "Chicken Breast",
          operatorSignal: "count_today",
          internalReasons: ["repeated_shortfall"],
        },
      ],
      purchasing: [{ kind: "order_more", productName: "Chicken Breast", confidence: "high" }],
    });

    const titles = cards.map((card) => card.title);
    const verbs = cards.map((card) => card.verb);
    expect(verbs).toContain("count");
    expect(verbs).not.toContain("order");
    expect(titles.some((title) => title.includes("Order"))).toBe(false);
    expect(titles).toContain("Please count Chicken Breast today");
  });

  it("still allows an Order for a trusted product", () => {
    const cards = buildOperatorGuidanceCards({
      inventoryTruth: [{ productId: "lamb", productName: "Lamb Mince", operatorSignal: "trusted" }],
      purchasing: [{ kind: "order_more", productName: "Lamb Mince", confidence: "high" }],
    });
    expect(cards.map((card) => card.verb)).toContain("order");
    expect(cards.some((card) => card.title === "Order Lamb Mince tomorrow")).toBe(true);
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
