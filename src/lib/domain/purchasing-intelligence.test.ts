import { describe, expect, it } from "vitest";

import {
  buildDataQuality,
  buildProductsNeedingAttention,
  buildPurchasingRecommendations,
  buildSupplierReadiness,
  capConfidence,
} from "./purchasing-intelligence";

const NOW = new Date("2026-06-01T09:00:00.000Z");

describe("purchasing recommendations", () => {
  it("suppresses Order advice for a low-confidence product (confidence→verb contract)", () => {
    // Same conditions that would normally produce 'Order tomorrow', but the
    // truth engine cannot trust this product's stock — so no order advice is
    // shown on the purchasing page either. Its action is 'count' (on TODAY).
    const recs = buildPurchasingRecommendations({
      now: NOW,
      productWaste: [{ productName: "Chicken Breast", weeklyWasteValue: 30, weeklyWasteKg: 3 }],
      depletion: [
        { productName: "Chicken Breast", state: "enough_data", remainingWeightKg: 4, daysUntilRunout: 2, dailyVelocityKg: 2.5 },
      ],
      lowConfidenceProductNames: ["chicken breast"],
    });
    expect(recs).toHaveLength(0);
  });

  it("recommends ordering more when a steady seller is about to run out", () => {
    const recs = buildPurchasingRecommendations({
      now: NOW,
      productWaste: [],
      depletion: [
        { productName: "Chicken Breast", state: "enough_data", remainingWeightKg: 4, daysUntilRunout: 2, dailyVelocityKg: 2.5 },
      ],
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: "order_more", productName: "Chicken Breast", confidence: "high" });
    expect(recs[0]?.title).toBe("Order Chicken Breast tomorrow");
    expect(recs[0]?.reason).toBe("Chicken Breast is running low.");
    expect(recs[0]?.operatorActionLabel).toBe("Order tomorrow");
    expect(recs[0]?.operatorDetail).toBe("About 2 days of stock left.");
  });

  it("does not recommend ordering more when there is plenty of cover", () => {
    const recs = buildPurchasingRecommendations({
      now: NOW,
      productWaste: [],
      depletion: [
        { productName: "Lamb Leg", state: "enough_data", remainingWeightKg: 40, daysUntilRunout: 20, dailyVelocityKg: 2 },
      ],
    });
    expect(recs).toHaveLength(0);
  });

  it("stays silent when there isn't enough sales history (no guessing)", () => {
    const recs = buildPurchasingRecommendations({
      now: NOW,
      productWaste: [],
      depletion: [
        { productName: "New Sausage", state: "insufficient_sales_history", remainingWeightKg: 1, daysUntilRunout: null, dailyVelocityKg: null },
      ],
    });
    expect(recs).toHaveLength(0);
  });

  it("recommends ordering less when a product is wasting money", () => {
    const recs = buildPurchasingRecommendations({
      now: NOW,
      depletion: [],
      productWaste: [{ productName: "Beef Diced", weeklyWasteValue: 10, weeklyWasteKg: 1.5 }],
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: "order_less", productName: "Beef Diced" });
    expect(recs[0]?.title).toBe("Order less Beef Diced next time");
    expect(recs[0]?.reason).toBe("Beef Diced is not moving cleanly enough.");
    expect(recs[0]?.operatorDetail).toBe("Potential value at risk: £10.00.");
  });

  it("ranks waste (order less) ahead of stock (order more)", () => {
    const recs = buildPurchasingRecommendations({
      now: NOW,
      depletion: [
        { productName: "Chicken Breast", state: "enough_data", remainingWeightKg: 4, daysUntilRunout: 2, dailyVelocityKg: 2.5 },
      ],
      productWaste: [{ productName: "Beef Diced", weeklyWasteValue: 10, weeklyWasteKg: 1.5 }],
    });
    expect(recs.map((rec) => rec.kind)).toEqual(["order_less", "order_more"]);
  });

  it("never lets confidence exceed the data-quality cap", () => {
    const recs = buildPurchasingRecommendations({
      now: NOW,
      confidenceCap: "low",
      productWaste: [],
      depletion: [
        { productName: "Chicken Breast", state: "enough_data", remainingWeightKg: 4, daysUntilRunout: 1, dailyVelocityKg: 2.5 },
      ],
    });
    expect(recs[0]?.confidence).toBe("low");
  });
});

describe("capConfidence", () => {
  it("lowers but never raises confidence", () => {
    expect(capConfidence("high", "medium")).toBe("medium");
    expect(capConfidence("low", "high")).toBe("low");
  });
});

describe("data quality", () => {
  it("is 100% when nothing is missing", () => {
    const dq = buildDataQuality({
      productCount: 10,
      missingCostCount: 0,
      missingPriceCount: 0,
      missingStockInfoCount: 0,
      supplierCount: 3,
      missingCertificateCount: 0,
    });
    expect(dq.score).toBe(100);
    expect(dq.band).toBe("high");
    expect(dq.confidenceCap).toBe("high");
  });

  it("drops and caps confidence as data goes missing", () => {
    const dq = buildDataQuality({
      productCount: 10,
      missingCostCount: 10,
      missingPriceCount: 5,
      missingStockInfoCount: 10,
      supplierCount: 2,
      missingCertificateCount: 2,
    });
    expect(dq.score).toBeLessThan(70);
    expect(dq.band).toBe("low");
    expect(dq.confidenceCap).toBe("low");
  });

  it("reports zero score with no products rather than fake confidence", () => {
    const dq = buildDataQuality({
      productCount: 0,
      missingCostCount: 0,
      missingPriceCount: 0,
      missingStockInfoCount: 0,
      supplierCount: 0,
      missingCertificateCount: 0,
    });
    expect(dq.score).toBe(0);
  });
});

describe("products needing attention", () => {
  it("lists every data gap, most-broken first", () => {
    const result = buildProductsNeedingAttention([
      { productName: "Good Product", isActive: true, pricePerUnit: 5, hasCost: true, unitsSold: 10, hasStockInfo: true },
      { productName: "Broken Product", isActive: false, pricePerUnit: 0, hasCost: false, unitsSold: 0, hasStockInfo: false },
      { productName: "No Cost", isActive: true, pricePerUnit: 8, hasCost: false, unitsSold: 4, hasStockInfo: true },
    ]);
    expect(result.map((p) => p.productName)).toEqual(["Broken Product", "No Cost"]);
    expect(result[0]?.issues).toContain("Add a sale price");
    expect(result[0]?.issues).toContain("Add a cost price");
  });
});

describe("supplier readiness", () => {
  it("is ready when costs, expiry and certificates are all clean", () => {
    const result = buildSupplierReadiness({
      missingCostCount: 0,
      marginVisibleCount: 8,
      weeklyWasteValue: 5,
      expiringStockCount: 0,
      expiredCertificateCount: 0,
      hasUrgentReorder: false,
      seasonalEventApproaching: false,
    });
    expect(result.overall).toBe("ready");
  });

  it("needs review when a blocking check fails (missing costs)", () => {
    const result = buildSupplierReadiness({
      missingCostCount: 3,
      marginVisibleCount: 5,
      weeklyWasteValue: 5,
      expiringStockCount: 0,
      expiredCertificateCount: 0,
      hasUrgentReorder: false,
      seasonalEventApproaching: false,
    });
    expect(result.overall).toBe("needs_review");
  });

  it("needs review when a certificate is expired", () => {
    const result = buildSupplierReadiness({
      missingCostCount: 0,
      marginVisibleCount: 5,
      weeklyWasteValue: 5,
      expiringStockCount: 0,
      expiredCertificateCount: 1,
      hasUrgentReorder: false,
      seasonalEventApproaching: false,
    });
    expect(result.overall).toBe("needs_review");
  });
});

describe("stock honesty — purchasing confidence cap", () => {
  it("high data quality band does not by itself imply inventory-truth is exact", () => {
    // Two distinct confidence axes (see confidence-routing.ts):
    //   - DATA QUALITY: are costs/prices/stock info present? (this function)
    //   - INVENTORY TRUTH: do we trust the live stock level? (truth-hardening)
    // A "high" data-quality band controls recommendation *strength*; it does NOT
    // assert the stock level is exact. Whether an "Order" is even shown is gated
    // separately by the inventory-truth confidence→verb contract.
    const quality = buildDataQuality({
      productCount: 10,
      missingCostCount: 0,
      missingPriceCount: 0,
      missingStockInfoCount: 0,
      supplierCount: 2,
      missingCertificateCount: 0,
    });
    expect(quality.band).toBe("high");
    // A "high" data-quality cap does NOT emit any "trusted" stock-truth claim; the
    // band name is about information completeness, not stock exactness.
    expect(quality.band).not.toBe("trusted");
    // capConfidence with a "high" cap only means recommendations are allowed at that
    // confidence level — it says nothing about live inventory truth.
    expect(capConfidence("high", quality.confidenceCap)).toBe("high");
  });

  it("recommendations are capped by data quality, independently of inventory-truth gating", () => {
    // The data-quality cap controls recommendation strength. Whether the resulting
    // "Order" reaches the operator is decided downstream by the inventory-truth
    // confidence→verb contract (a low-confidence product is routed to "Count").
    const recs = buildPurchasingRecommendations({
      now: NOW,
      confidenceCap: "high",
      productWaste: [],
      depletion: [
        { productName: "Lamb Leg", state: "enough_data", remainingWeightKg: 2, daysUntilRunout: 1, dailyVelocityKg: 2 },
      ],
    });
    expect(recs).toHaveLength(1);
    // Confidence can be "high" based on data quality, but the disclaimer in the UI
    // must clarify that stock is intake/count based, not sales-decremented.
    expect(recs[0]?.confidence).toBe("high");
  });
});
