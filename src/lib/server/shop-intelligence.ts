import "server-only";

import { buildWeightedBatchCostMap } from "@/lib/domain/cost-sources";
import type { InventoryOperatorSignal, InventoryTruthGuidanceInput } from "@/lib/domain/operator-guidance";
import { buildShopIntelligence } from "@/lib/shop-intelligence/engine";
import type { ShopSnapshot, SnapshotBatch } from "@/lib/shop-intelligence/snapshot";
import type { ShopIntelligence } from "@/lib/shop-intelligence/types";
import { getAllProducts, getProductCostMap } from "@/lib/server/catalog";
import { getInventoryBatches, type InventoryBatch } from "@/lib/server/compliance-inventory";
import { getDashboardMetrics } from "@/lib/server/dashboard";
import { getOperationsIntelligence } from "@/lib/server/operations-intelligence";
import { getPurchasingPlan } from "@/lib/server/purchasing-intelligence";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { getLocalIsoDate } from "@/lib/domain/checkout-rules";

export type { ShopIntelligence } from "@/lib/shop-intelligence/types";

const DAY_MS = 86_400_000;

type InventoryConfidenceMonitorRow = {
  product_id: string;
  product_name: string | null;
  operator_signal: string;
  internal_reasons: string[] | null;
};

function toSnapshotBatch(batch: InventoryBatch): SnapshotBatch {
  return {
    productName: batch.productName,
    status: batch.status,
    remainingWeightKg: batch.remainingWeightKg,
    daysToExpiry: batch.daysToExpiry,
    expectedWeightKg: batch.expectedWeightKg,
    actualWeightKg: batch.actualWeightKg,
    varianceKg: batch.varianceKg,
    actualConfirmedAt: batch.actualConfirmedAt,
    estimatedValueAtRisk: batch.estimatedValueAtRisk,
  };
}

/** Days since the most recent stock activity (a new batch or a confirmed actual). */
function daysSinceLastStockActivity(batches: InventoryBatch[], now: Date): number | null {
  const times = batches.flatMap((batch) => {
    const points: number[] = [];
    const received = Date.parse(`${batch.receivedDate}T00:00:00.000Z`);
    if (Number.isFinite(received)) points.push(received);
    if (batch.actualConfirmedAt) {
      const confirmed = Date.parse(batch.actualConfirmedAt);
      if (Number.isFinite(confirmed)) points.push(confirmed);
    }
    return points;
  });
  if (times.length === 0) return null;
  return Math.max(0, Math.floor((now.getTime() - Math.max(...times)) / DAY_MS));
}

/** Best-effort week-to-date revenue (real, non-cancelled orders). Null on any fault. */
async function getWeekToDateRevenue(branchId: string, now: Date): Promise<number | null> {
  if (!hasSupabaseServiceEnv()) return null;
  try {
    const weekStart = `${getLocalIsoDate(new Date(now.getTime() - 6 * DAY_MS))}T00:00:00.000Z`;
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("orders")
      .select("subtotal, status, is_test, created_at")
      .eq("branch_id", branchId)
      .gte("created_at", weekStart);
    if (error || !data) return null;
    return (
      Math.round(
        (data as Array<{ subtotal: string | number; status: string; is_test: boolean | null }>)
          .filter((row) => !row.is_test && row.status !== "cancelled")
          .reduce((sum, row) => sum + (typeof row.subtotal === "number" ? row.subtotal : Number(row.subtotal) || 0), 0) * 100,
      ) / 100
    );
  } catch (error) {
    console.error("[shop-intelligence] week revenue query failed", { branchId, error });
    return null;
  }
}

async function getInventoryTruthGuidance(branchId: string): Promise<InventoryTruthGuidanceInput[]> {
  if (!hasSupabaseServiceEnv()) return [];

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("inventory_confidence_monitor")
      .select("product_id, product_name, operator_signal, internal_reasons")
      .eq("branch_id", branchId);

    if (error || !data) return [];

    return (data as InventoryConfidenceMonitorRow[])
      .map((row): InventoryTruthGuidanceInput | null => {
        const signal = toInventoryOperatorSignal(row.operator_signal);
        if (!signal) return null;
        return {
          productId: row.product_id,
          productName: row.product_name ?? "this item",
          operatorSignal: signal,
          internalReasons: row.internal_reasons ?? [],
        };
      })
      .filter((row): row is InventoryTruthGuidanceInput => row !== null);
  } catch (error) {
    console.error("[shop-intelligence] inventory truth guidance query failed", { branchId, error });
    return [];
  }
}

function toInventoryOperatorSignal(value: string): InventoryOperatorSignal | null {
  if (value === "trusted" || value === "count_soon" || value === "count_today") return value;
  return null;
}

/**
 * Assemble the V8 `ShopSnapshot` from the platform's existing reads and run the
 * pure intelligence engine over it. Adds no new tables and mutates nothing.
 */
export async function getShopIntelligence(branchId: string, now = new Date()): Promise<ShopIntelligence> {
  const [metrics, intelligence, batches, purchasing, products, productCostMap, weekToDate, inventoryTruth] = await Promise.all([
    getDashboardMetrics(branchId, now),
    getOperationsIntelligence(branchId, now),
    getInventoryBatches(branchId),
    getPurchasingPlan(branchId, now),
    getAllProducts(branchId),
    getProductCostMap(branchId),
    getWeekToDateRevenue(branchId, now),
    getInventoryTruthGuidance(branchId),
  ]);

  // Cost coverage: a product is "costed" if it has a direct cost or a batch cost.
  const costByProduct = new Map<string, number>(productCostMap);
  for (const [productId, cost] of buildWeightedBatchCostMap(batches)) {
    if (!costByProduct.has(productId)) costByProduct.set(productId, cost);
  }
  const productIdsWithStock = new Set(batches.map((batch) => batch.productId));
  const unitsSoldById = new Map<string, number>();
  for (const row of intelligence.productPerformance.rows) {
    if (row.productId) unitsSoldById.set(row.productId, row.unitsSold);
  }

  const missingCost = products.filter((product) => !costByProduct.has(product.id)).length;
  const missingStockInfo = products.filter((product) => !productIdsWithStock.has(product.id)).length;
  const activeSellingNoCost = products.filter(
    (product) => product.isAvailable && !costByProduct.has(product.id) && (unitsSoldById.get(product.id) ?? 0) > 0,
  ).length;

  const snapshot: ShopSnapshot = {
    now: now.toISOString(),
    dataConfigured: metrics.configured,
    orders: { today: metrics.orderCount, awaitingPrep: metrics.awaitingPrep, ready: metrics.readyCount },
    revenue: { today: metrics.estimatedRevenue, yesterday: intelligence.morning.revenueYesterday, weekToDate },
    stock: {
      batchesExpiringWithin3Days: metrics.batchesExpiringWithin3Days,
      valueAtRisk: metrics.stockValueAtRisk,
      activeBatchCount: batches.filter((batch) => batch.status === "active" && batch.remainingWeightKg > 0).length,
      daysSinceLastStockActivity: daysSinceLastStockActivity(batches, now),
    },
    expiry: {
      expiresToday: intelligence.expiry.expiresToday.length,
      expiresThisWeek: intelligence.expiry.expiresThisWeek.length,
      expired: intelligence.expiry.expired.length,
      valueAtRisk: intelligence.expiry.valueAtRisk,
    },
    depletion: intelligence.depletion.map((row) => ({
      productName: row.productName,
      state: row.state,
      remainingWeightKg: row.remainingWeightKg,
      daysUntilRunout: row.daysUntilRunout,
      dailyVelocityKg: row.dailyVelocityKg,
    })),
    waste: {
      weekValue: intelligence.waste.weekValue,
      monthValue: intelligence.waste.monthValue,
      byProduct: intelligence.waste.byProduct,
      byReason: intelligence.waste.byReason,
      eventsThisWeek: metrics.wasteEventsThisWeek,
    },
    margin: {
      best: intelligence.productPerformance.best[0]
        ? { productName: intelligence.productPerformance.best[0].productName, grossProfit: intelligence.productPerformance.best[0].grossProfit }
        : null,
      worst: intelligence.productPerformance.worst[0]
        ? {
            productName: intelligence.productPerformance.worst[0].productName,
            grossProfit: intelligence.productPerformance.worst[0].grossProfit,
            grossMarginPercentage: intelligence.productPerformance.worst[0].grossMarginPercentage,
          }
        : null,
      highestWasteDrag: intelligence.productPerformance.highestWasteDrag
        ? {
            productName: intelligence.productPerformance.highestWasteDrag.productName,
            wasteCost: intelligence.productPerformance.highestWasteDrag.wasteCost,
          }
        : null,
      rows: intelligence.productPerformance.rows.map((row) => ({
        productName: row.productName,
        revenue: row.revenue,
        grossProfit: row.grossProfit,
        grossMarginPercentage: row.grossMarginPercentage,
        unitsSold: row.unitsSold,
      })),
      unavailableCount: intelligence.productPerformance.unavailable.length,
    },
    compliance: {
      rows: intelligence.compliance.rows.map((row) => ({
        supplierName: row.supplierName,
        daysToExpiry: row.daysToExpiry,
        band: row.band,
      })),
      expired: metrics.expiredCertificates,
      expiringSoon: metrics.expiringCertificates,
      missing: metrics.missingCertificates,
      status: intelligence.compliance.status,
    },
    batches: batches.map(toSnapshotBatch),
    products: {
      total: products.length,
      zeroPrice: products.filter((product) => !(product.pricePerUnit > 0)).length,
      missingCost,
      missingStockInfo,
      activeSellingNoCost,
    },
    purchasing: {
      dataQualityScore: purchasing.dataQuality.score,
      dataQualityBand: purchasing.dataQuality.band,
      topRecommendations: purchasing.recommendations.slice(0, 3).map((rec) => ({
        kind: rec.kind,
        productName: rec.productName,
        title: rec.title,
        reason: rec.reason,
        confidence: rec.confidence,
      })),
      supplierReadiness: purchasing.supplierReadiness.overall,
    },
    inventoryTruth,
    system: { failedSmsToday: metrics.failedSmsCount, realtimeHealthy: metrics.realtimeMode === "websocket" },
    ownerActions: intelligence.actions,
  };

  return buildShopIntelligence(snapshot);
}
