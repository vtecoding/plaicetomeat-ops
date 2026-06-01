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
    expect(recs[0]?.metrics.find((m) => m.label === "Avg weekly sales")?.value).toBe("17.5kg");
    expect(recs[0]?.reason).toContain("Chicken Breast");
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
    expect(recs[0]?.reason).toContain("£10.00");
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
    expect(result[0]?.issues).toContain("No sale price set");
    expect(result[0]?.issues).toContain("No cost price — margin can't be calculated");
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
