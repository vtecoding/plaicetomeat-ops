import "server-only";

import {
  buildDataQuality,
  buildProductsNeedingAttention,
  buildPurchasingRecommendations,
  buildSupplierReadiness,
  formatGeneratedDate,
  type DataQuality,
  type ProductNeedingAttention,
  type PurchasingRecommendation,
  type SupplierReadiness,
} from "@/lib/domain/purchasing-intelligence";
import { getActiveSeasonalEvents } from "@/lib/action-intelligence/seasonal-calendar";
import { getAllProducts, getProductCostMap } from "@/lib/server/catalog";
import { getInventoryBatches } from "@/lib/server/compliance-inventory";
import { getOperationsIntelligence, type OpsIntelligence } from "@/lib/server/operations-intelligence";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type PurchasingPlan = {
  generatedDate: string;
  dataQuality: DataQuality;
  recommendations: PurchasingRecommendation[];
  productsNeedingAttention: ProductNeedingAttention[];
  supplierReadiness: SupplierReadiness;
  seasonalPrep: Array<{ name: string; daysUntil: number; dateConfidence: "fixed" | "estimated"; prepTasks: string[] }>;
  margin: {
    best: { productName: string; grossProfit: number | null } | null;
    worst: { productName: string; grossProfit: number | null } | null;
    highestWaste: { productName: string; wasteCost: number } | null;
    highestRevenue: { productName: string; revenue: number } | null;
  };
};

/**
 * Per-product waste value for the last 7 days. Isolated and best-effort: if the
 * waste table is unavailable the owner simply sees no "order less" advice rather
 * than an error.
 */
async function getWeeklyWasteByProduct(
  branchId: string,
  now: Date,
  costByProduct: Map<string, number>,
): Promise<Array<{ productName: string; weeklyWasteValue: number; weeklyWasteKg: number }>> {
  if (!hasSupabaseServiceEnv()) return [];

  const weekStart = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("inventory_waste_events")
      .select("waste_kg, created_at, product:products!inner(id, name, branch_id), batch:inventory_batches(cost_per_kg)")
      .eq("product.branch_id", branchId)
      .gte("created_at", weekStart);

    if (error || !data) return [];

    const byProduct = new Map<string, { weeklyWasteValue: number; weeklyWasteKg: number }>();
    for (const row of data as Array<{
      waste_kg: string | number;
      product: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
      batch: { cost_per_kg: string | number | null } | { cost_per_kg: string | number | null }[] | null;
    }>) {
      const product = Array.isArray(row.product) ? row.product[0] : row.product;
      const batch = Array.isArray(row.batch) ? row.batch[0] : row.batch;
      if (!product) continue;
      const wasteKg = Number(row.waste_kg) || 0;
      const costPerKg = Number(batch?.cost_per_kg ?? costByProduct.get(product.id) ?? 0) || 0;
      const existing = byProduct.get(product.name ?? "Unknown product") ?? { weeklyWasteValue: 0, weeklyWasteKg: 0 };
      existing.weeklyWasteValue += wasteKg * costPerKg;
      existing.weeklyWasteKg += wasteKg;
      byProduct.set(product.name ?? "Unknown product", existing);
    }

    return [...byProduct.entries()].map(([productName, value]) => ({
      productName,
      weeklyWasteValue: Math.round(value.weeklyWasteValue * 100) / 100,
      weeklyWasteKg: Math.round(value.weeklyWasteKg * 1000) / 1000,
    }));
  } catch (error) {
    console.error("[purchasing-intelligence] weekly waste query failed", { branchId, error });
    return [];
  }
}

export async function getPurchasingPlan(branchId: string, now = new Date()): Promise<PurchasingPlan> {
  const [intelligence, products, batches] = await Promise.all([
    getOperationsIntelligence(branchId, now),
    getAllProducts(branchId),
    getInventoryBatches(branchId),
  ]);

  const costByProduct = new Map<string, number>();
  const productIdsWithStock = new Set<string>();
  for (const batch of batches) {
    productIdsWithStock.add(batch.productId);
    if (batch.costPerKg > 0 && !costByProduct.has(batch.productId)) {
      costByProduct.set(batch.productId, batch.costPerKg);
    }
  }
  // Per-product cost set via the cutting guide fills any gaps.
  const productCostMap = await getProductCostMap(branchId);
  for (const [productId, cost] of productCostMap) {
    if (!costByProduct.has(productId)) costByProduct.set(productId, cost);
  }

  // Units sold per product id, from the performance rows the platform already builds.
  const unitsSoldById = new Map<string, number>();
  for (const row of intelligence.productPerformance.rows) {
    if (row.productId) unitsSoldById.set(row.productId, row.unitsSold);
  }

  const productWaste = await getWeeklyWasteByProduct(branchId, now, costByProduct);

  const missingCostCount = products.filter((product) => !costByProduct.has(product.id)).length;
  const missingPriceCount = products.filter((product) => !(product.pricePerUnit > 0)).length;
  const missingStockInfoCount = products.filter((product) => !productIdsWithStock.has(product.id)).length;
  const expiredCertificateCount = intelligence.compliance.rows.filter(
    (row) => row.daysToExpiry !== null && row.daysToExpiry < 0,
  ).length;
  const supplierCount = intelligence.compliance.rows.length;

  const dataQuality = buildDataQuality({
    productCount: products.length,
    missingCostCount,
    missingPriceCount,
    missingStockInfoCount,
    supplierCount,
    missingCertificateCount: intelligence.compliance.rows.filter((row) => row.daysToExpiry === null).length,
  });

  const recommendations = buildPurchasingRecommendations({
    now,
    confidenceCap: dataQuality.confidenceCap,
    depletion: intelligence.depletion.map((row) => ({
      productName: row.productName,
      state: row.state,
      remainingWeightKg: row.remainingWeightKg,
      daysUntilRunout: row.daysUntilRunout,
      dailyVelocityKg: row.dailyVelocityKg,
    })),
    productWaste,
  });

  const productsNeedingAttention = buildProductsNeedingAttention(
    products.map((product) => ({
      productName: product.name,
      isActive: product.isAvailable,
      pricePerUnit: product.pricePerUnit,
      hasCost: costByProduct.has(product.id),
      unitsSold: unitsSoldById.get(product.id) ?? 0,
      hasStockInfo: productIdsWithStock.has(product.id),
    })),
  );

  const supplierReadiness = buildSupplierReadiness({
    missingCostCount,
    marginVisibleCount: intelligence.productPerformance.best.length,
    weeklyWasteValue: intelligence.waste.weekValue,
    expiringStockCount: intelligence.expiry.expiresThisWeek.length,
    expiredCertificateCount,
    hasUrgentReorder: recommendations.some((rec) => rec.kind === "order_more"),
    seasonalEventApproaching: getActiveSeasonalEvents(now).length > 0,
  });

  const seasonalPrep = getActiveSeasonalEvents(now)
    .filter((event) => event.prepTasks && event.prepTasks.length > 0)
    .map((event) => ({
      name: event.name,
      daysUntil: event.daysUntil,
      dateConfidence: event.dateConfidence,
      prepTasks: event.prepTasks ?? [],
    }));

  return {
    generatedDate: formatGeneratedDate(now),
    dataQuality,
    recommendations,
    productsNeedingAttention,
    supplierReadiness,
    seasonalPrep,
    margin: deriveMargin(intelligence),
  };
}

function deriveMargin(intelligence: OpsIntelligence): PurchasingPlan["margin"] {
  const best = intelligence.productPerformance.best[0] ?? null;
  const worst = intelligence.productPerformance.worst[0] ?? null;
  const highestWaste = intelligence.productPerformance.highestWasteDrag ?? null;
  const highestRevenue = [...intelligence.productPerformance.rows].sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  return {
    best: best ? { productName: best.productName, grossProfit: best.grossProfit } : null,
    worst: worst ? { productName: worst.productName, grossProfit: worst.grossProfit } : null,
    highestWaste: highestWaste ? { productName: highestWaste.productName, wasteCost: highestWaste.wasteCost } : null,
    highestRevenue: highestRevenue ? { productName: highestRevenue.productName, revenue: highestRevenue.revenue } : null,
  };
}
