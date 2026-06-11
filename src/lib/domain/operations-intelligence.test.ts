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
      unavailableReason: "Add a cost to see profit.",
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

  it("flags a regular who has gone quiet, not occasional or still-active buyers", () => {
    const now = new Date("2026-06-30T10:00:00Z");
    const result = buildCustomerIntelligence(
      [
        // Aisha: a weekly regular who stopped 46 days ago → lapsed. Buys lamb shoulder most.
        { customerName: "Aisha", customerPhone: "1", subtotal: 20, createdAt: "2026-05-01T10:00:00Z", items: ["Lamb Shoulder"] },
        { customerName: "Aisha", customerPhone: "1", subtotal: 20, createdAt: "2026-05-08T10:00:00Z", items: ["Lamb Shoulder", "Chicken Breast"] },
        { customerName: "Aisha", customerPhone: "1", subtotal: 20, createdAt: "2026-05-15T10:00:00Z", items: ["Lamb Shoulder"] },
        // Bilal: also a regular, but still ordering this week → not lapsed.
        { customerName: "Bilal", customerPhone: "2", subtotal: 30, createdAt: "2026-06-20T10:00:00Z" },
        { customerName: "Bilal", customerPhone: "2", subtotal: 30, createdAt: "2026-06-25T10:00:00Z" },
        { customerName: "Bilal", customerPhone: "2", subtotal: 30, createdAt: "2026-06-29T10:00:00Z" },
        // Dina: three orders but ~6 weeks apart → occasional, not a "regular" cadence.
        { customerName: "Dina", customerPhone: "3", subtotal: 15, createdAt: "2026-03-01T10:00:00Z" },
        { customerName: "Dina", customerPhone: "3", subtotal: 15, createdAt: "2026-04-15T10:00:00Z" },
        { customerName: "Dina", customerPhone: "3", subtotal: 15, createdAt: "2026-05-30T10:00:00Z" },
        // Carl: only two orders → not enough to call a regular.
        { customerName: "Carl", customerPhone: "4", subtotal: 50, createdAt: "2026-04-01T10:00:00Z" },
        { customerName: "Carl", customerPhone: "4", subtotal: 50, createdAt: "2026-04-08T10:00:00Z" },
      ],
      now,
    );

    expect(result.lapsedRegulars.map((customer) => customer.customerName)).toEqual(["Aisha"]);
    expect(result.lapsedRegulars[0]).toMatchObject({
      customerName: "Aisha",
      orders: 3,
      averageOrderValue: 20,
      daysSinceLastOrder: 46,
      favouriteProduct: "Lamb Shoulder",
    });
  });

  it("flags no lapsed regulars when there is no history", () => {
    expect(buildCustomerIntelligence([]).lapsedRegulars).toEqual([]);
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
