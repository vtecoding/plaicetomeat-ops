/**
 * Shared fixtures for the shop-intelligence unit tests. Imported only by `*.test.ts`
 * files (never by the app), so it adds nothing to the runtime bundle.
 */
import type { OwnerAction } from "@/lib/action-intelligence/action-types";
import type { ShopSnapshot, SnapshotBatch } from "./snapshot";

export function makeAction(over: Partial<OwnerAction> = {}): OwnerAction {
  return {
    id: "stock-low-beef-mince",
    category: "stock",
    group: "stock",
    severity: "warning",
    title: "Beef mince is running low",
    explanation: "Beef mince is selling faster than stock is coming in.",
    estimatedImpact: "Customers may be unable to order beef mince within a few days.",
    recommendedAction: "Order more beef mince this week.",
    sourceMetrics: { remainingWeightKg: 4, daysOfCover: 2 },
    createdAt: "2026-06-03T08:00:00.000Z",
    confidence: "high",
    ...over,
  };
}

export function makeBatch(over: Partial<SnapshotBatch> = {}): SnapshotBatch {
  return {
    productName: "Lamb leg",
    status: "active",
    remainingWeightKg: 10,
    daysToExpiry: 5,
    expectedWeightKg: 18,
    actualWeightKg: 18,
    varianceKg: 0,
    actualConfirmedAt: "2026-06-01T10:00:00.000Z",
    estimatedValueAtRisk: 80,
    ...over,
  };
}

export function makeSnapshot(over: Partial<ShopSnapshot> = {}): ShopSnapshot {
  return {
    now: "2026-06-03T08:00:00.000Z",
    dataConfigured: true,
    orders: { today: 6, awaitingPrep: 2, ready: 1 },
    revenue: { today: 240, yesterday: 210, weekToDate: 1450 },
    stock: { batchesExpiringWithin3Days: 0, valueAtRisk: 0, activeBatchCount: 8, daysSinceLastStockActivity: 2 },
    expiry: { expiresToday: 0, expiresThisWeek: 1, expired: 0, valueAtRisk: 40 },
    depletion: [
      { productName: "Beef mince", state: "enough_data", remainingWeightKg: 4, daysUntilRunout: 2, dailyVelocityKg: 2 },
      { productName: "Chicken breast", state: "enough_data", remainingWeightKg: 30, daysUntilRunout: 12, dailyVelocityKg: 2.5 },
    ],
    waste: {
      weekValue: 18.5,
      monthValue: 60,
      byProduct: [
        { label: "Chicken thighs", value: 12 },
        { label: "Beef trim", value: 6.5 },
      ],
      byReason: [{ label: "Expired", value: 12 }],
      eventsThisWeek: 3,
    },
    margin: {
      best: { productName: "Chicken breast", grossProfit: 120 },
      worst: { productName: "Lamb neck", grossProfit: 4, grossMarginPercentage: 6 },
      highestWasteDrag: { productName: "Chicken thighs", wasteCost: 12 },
      rows: [
        { productName: "Chicken breast", revenue: 300, grossProfit: 120, grossMarginPercentage: 40, unitsSold: 40 },
        { productName: "Lamb neck", revenue: 60, grossProfit: 4, grossMarginPercentage: 6, unitsSold: 8 },
      ],
      unavailableCount: 0,
    },
    compliance: {
      rows: [{ supplierName: "Halal Wholesale", daysToExpiry: 40, band: "expires_90_days" }],
      expired: 0,
      expiringSoon: 0,
      missing: 0,
      status: "Healthy",
    },
    batches: [makeBatch()],
    products: { total: 20, zeroPrice: 0, missingCost: 0, missingStockInfo: 2, activeSellingNoCost: 0 },
    purchasing: {
      dataQualityScore: 92,
      dataQualityBand: "high",
      topRecommendations: [
        { kind: "order_more", productName: "Beef mince", title: "Order more Beef mince", reason: "2 days of cover left.", confidence: "high" },
      ],
      supplierReadiness: "ready",
    },
    system: { failedSmsToday: 0, realtimeHealthy: true },
    ownerActions: [makeAction()],
    ...over,
  };
}
