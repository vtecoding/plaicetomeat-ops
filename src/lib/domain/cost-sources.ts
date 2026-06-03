export type CostSource = "product_cost" | "weighted_batch_cost" | "batch_cost" | "missing";

export type ResolvedCost = {
  value: number | null;
  source: CostSource;
};

export type WeightedBatchCostInput = {
  productId: string;
  costPerKg: number;
  remainingWeightKg: number;
  status: string;
};

const NO_COST: ResolvedCost = { value: null, source: "missing" };

function round(value: number, dp = 2) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

export function buildWeightedBatchCostMap(batches: readonly WeightedBatchCostInput[]) {
  const totals = new Map<string, { weightedCost: number; weightKg: number }>();

  for (const batch of batches) {
    if (batch.status !== "active") continue;
    if (!Number.isFinite(batch.costPerKg) || batch.costPerKg <= 0) continue;
    if (!Number.isFinite(batch.remainingWeightKg) || batch.remainingWeightKg <= 0) continue;

    const existing = totals.get(batch.productId) ?? { weightedCost: 0, weightKg: 0 };
    existing.weightedCost += batch.costPerKg * batch.remainingWeightKg;
    existing.weightKg += batch.remainingWeightKg;
    totals.set(batch.productId, existing);
  }

  const map = new Map<string, number>();
  for (const [productId, total] of totals) {
    if (total.weightKg <= 0) continue;
    map.set(productId, round(total.weightedCost / total.weightKg));
  }

  return map;
}

export function resolveMarginCost(productCost: number | null | undefined, weightedBatchCost: number | null | undefined): ResolvedCost {
  if (isPositiveCost(productCost)) return { value: round(productCost), source: "product_cost" };
  if (isPositiveCost(weightedBatchCost)) return { value: round(weightedBatchCost), source: "weighted_batch_cost" };
  return NO_COST;
}

export function resolvePurchasingCost(weightedBatchCost: number | null | undefined, productCost: number | null | undefined): ResolvedCost {
  if (isPositiveCost(weightedBatchCost)) return { value: round(weightedBatchCost), source: "weighted_batch_cost" };
  if (isPositiveCost(productCost)) return { value: round(productCost), source: "product_cost" };
  return NO_COST;
}

export function resolveInventoryCost(batchCost: number | null | undefined): ResolvedCost {
  if (isPositiveCost(batchCost)) return { value: round(batchCost), source: "batch_cost" };
  return NO_COST;
}

export function getCostPolicySummary() {
  return [
    {
      context: "Margin",
      winner: "products.cost_per_kg",
      fallback: "weighted active batch cost",
      note: "Committed product cost wins for pricing and gross margin.",
    },
    {
      context: "Purchasing",
      winner: "weighted active batch cost",
      fallback: "products.cost_per_kg",
      note: "Stock planning values on-hand inventory first, then falls back to committed product cost.",
    },
    {
      context: "Inventory",
      winner: "inventory_batches.cost_per_kg",
      fallback: "none",
      note: "Each batch keeps its own received cost and never borrows from another product.",
    },
    {
      context: "Dashboard",
      winner: "products.cost_per_kg",
      fallback: "weighted active batch cost",
      note: "Dashboard profit uses the same committed product cost that powers margin reporting.",
    },
  ] as const;
}

function isPositiveCost(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
