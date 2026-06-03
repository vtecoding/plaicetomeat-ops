import { describe, expect, it } from "vitest";

import {
  buildCertificateForecast,
  buildBasketIntelligence,
  buildCustomerIntelligence,
  buildDailyProfitEstimate,
  buildExpiryCommandCentre,
  buildInventoryDepletionForecast,
  buildMigrationHealth,
  buildProductPerformance,
  buildWasteAnalytics,
} from "@/lib/domain/operations-intelligence";

describe("operations intelligence", () => {
  it("groups expiry risk by date and value", () => {
    const result = buildExpiryCommandCentre([
      { productName: "Chicken", remainingWeightKg: 12, valueAtRisk: 72, expiryDate: "2026-06-01", daysToExpiry: 0 },
      { productName: "Lamb", remainingWeightKg: 5, valueAtRisk: 50, expiryDate: "2026-06-03", daysToExpiry: 2 },
      { productName: "Beef", remainingWeightKg: 2, valueAtRisk: 20, expiryDate: "2026-05-31", daysToExpiry: -1 },
    ]);

    expect(result.expiresToday).toHaveLength(1);
    expect(result.expiresThisWeek).toHaveLength(2);
    expect(result.expired).toHaveLength(1);
    expect(result.valueAtRisk).toBe(142);
  });

  it("builds waste intelligence for product and reason groups", () => {
    const result = buildWasteAnalytics(
      [
        { productName: "Chicken Wings", wasteKg: 4, reason: "expired", value: 24, createdAt: "2026-06-01T10:00:00Z" },
        { productName: "Chicken Wings", wasteKg: 2, reason: "customer_return", value: 12, createdAt: "2026-06-01T11:00:00Z" },
        { productName: "Beef", wasteKg: 1, reason: "damaged", value: 9, createdAt: "2026-05-01T11:00:00Z" },
      ],
      new Date("2026-06-01T12:00:00Z"),
    );

    expect(result.mostWastedProduct).toBe("Chicken Wings");
    expect(result.monthValue).toBe(36);
    expect(result.byReason.map((row) => row.label)).toContain("Customer issue");
  });

  it("estimates gross profit from operational inputs", () => {
    expect(buildDailyProfitEstimate({ revenue: 427, inventoryCost: 210, wasteCost: 18 })).toEqual({
      revenue: 427,
      inventoryCost: 210,
      wasteCost: 18,
      estimatedGrossProfit: 199,
      unavailableReason: null,
    });
  });

  it("does not guess profit when product costs are missing", () => {
    expect(buildDailyProfitEstimate({ revenue: 427, inventoryCost: null, wasteCost: 18 })).toEqual({
      revenue: 427,
      inventoryCost: null,
      wasteCost: 18,
      estimatedGrossProfit: null,
      unavailableReason: "Margin unavailable - no cost source available.",
    });
  });

  it("makes product margin visible once an estimated product cost is present", () => {
    const result = buildProductPerformance([
      {
        productId: "lamb-leg",
        productName: "Lamb Leg",
        unitsSold: 2,
        unitsWasted: 0,
        revenue: 30,
        wasteValue: 0,
        estimatedCost: 18,
      },
    ]);

    expect(result.best[0]).toMatchObject({
      productName: "Lamb Leg",
      grossProfit: 12,
      grossMarginPercentage: 40,
      marginUnavailableReason: null,
    });
    expect(result.unavailable).toHaveLength(0);
  });

  it("tracks repeat customers from order history only", () => {
    const result = buildCustomerIntelligence([
      { customerName: "Aisha", customerPhone: "1", subtotal: 20, createdAt: "2026-06-01T10:00:00Z" },
      { customerName: "Aisha", customerPhone: "1", subtotal: 15, createdAt: "2026-05-30T10:00:00Z" },
      { customerName: "Bilal", customerPhone: "2", subtotal: 10, createdAt: "2026-06-01T11:00:00Z" },
    ]);

    expect(result.firstTimeCustomers).toBe(1);
    expect(result.repeatCustomers).toBe(1);
    expect(result.repeatRate).toBe(50);
    expect(result.topCustomers[0]?.spend).toBe(35);
    expect(result.topCustomers[0]?.averageOrderValue).toBe(17.5);
  });

  it("waits for enough real orders before basket recommendations", () => {
    const result = buildBasketIntelligence([]);

    expect(result.status).toBe("insufficient_history");
    expect(result.message).toBe("More customer orders are needed before recommendations can be shown.");
  });

  it("finds common basket pairings from real order history", () => {
    const orders = Array.from({ length: 5 }, (_, index) => ({
      orderId: `order-${index}`,
      subtotal: 20,
      createdAt: "2026-06-01T10:00:00Z",
      items: [
        { productId: "chicken", productName: "Chicken Breast" },
        { productId: "mince", productName: "Mince" },
      ],
    }));

    const result = buildBasketIntelligence(orders);

    expect(result.status).toBe("ready");
    expect(result.topPairings[0]).toMatchObject({ productA: "Chicken Breast", productB: "Mince", count: 5 });
  });

  it("forecasts depletion only when sales history is strong enough", () => {
    const result = buildInventoryDepletionForecast(
      [
        {
          batchId: "batch-1",
          productId: "chicken",
          productName: "Chicken Breast",
          remainingWeightKg: 12,
          status: "active",
          expiryDate: "2026-06-10",
          daysToExpiry: 9,
        },
      ],
      [
        { productId: "chicken", quantity: 2, createdAt: "2026-05-30T10:00:00Z" },
        { productId: "chicken", quantity: 2, createdAt: "2026-05-31T10:00:00Z" },
        { productId: "chicken", quantity: 2, createdAt: "2026-06-01T10:00:00Z" },
      ],
      new Date("2026-06-01T12:00:00Z"),
    );

    expect(result[0]).toMatchObject({ state: "enough_data", daysUntilRunout: 6 });
  });

  it("forecasts supplier certificate health", () => {
    const result = buildCertificateForecast(
      [
        { supplierName: "Valid", certExpiry: "2026-08-01", active: true },
        { supplierName: "Expired", certExpiry: "2026-05-31", active: true },
      ],
      new Date("2026-06-01T00:00:00Z"),
    );

    expect(result.status).toBe("Critical");
    expect(result.rows.map((row) => row.band)).toContain("expired");
  });

  it("flags missing migrations", () => {
    const result = buildMigrationHealth({ expected: ["1", "2"], applied: ["1"] });

    expect(result.healthy).toBe(false);
    expect(result.missing).toEqual(["2"]);
  });
});
