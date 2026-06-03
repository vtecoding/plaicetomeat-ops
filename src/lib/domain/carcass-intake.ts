/**
 * Connected carcass intake — domain logic (pure, no IO).
 *
 * Turns the carcass *pricing* breakdown (see lib/butchery/carcass-breakdown) into
 * a reviewable *stock intake* plan: which cuts become saleable inventory, at what
 * real cost, which cuts still need a product mapping, and how much bone/fat/trim
 * is PROCESSING LOSS (kept strictly separate from retail waste).
 *
 * This module never invents costs and never decides to write anything — it only
 * shapes what the operator will review and confirm. The actual writes happen in
 * one atomic database RPC (admin_confirm_carcass_intake).
 */
import type { CarcassBreakdown } from "@/lib/butchery/carcass-breakdown";

export type IntakeType = "whole" | "side" | "quarter" | "primal";
export const INTAKE_TYPES: readonly IntakeType[] = ["whole", "side", "quarter", "primal"] as const;

export const INTAKE_TYPE_LABEL: Record<IntakeType, string> = {
  whole: "Whole carcass",
  side: "Side",
  quarter: "Quarter",
  primal: "Primal / part",
};

/** How a single cut will be received. */
export type IntakeCutPlan = {
  cutId: string;
  cutName: string;
  /** Processing-loss line (bone/fat/trim/moisture) — never becomes stock. */
  isWaste: boolean;
  expectedWeightKg: number;
  /** Honest blended real meat cost per kg (null for the loss line). */
  costPerKg: number | null;
  suggestedPricePerKg: number | null;
  marginPct: number | null;
  /** Linked product, or null = needs mapping (review item). */
  productId: string | null;
  /** Whether to push the calculated cost onto the linked product (review-first). */
  updateCost: boolean;
  /** Whether to push the suggested price onto the linked product (explicit only). */
  updatePrice: boolean;
};

export type IntakePlan = {
  saleableWeightKg: number;
  processingLossKg: number;
  processedWeightKg: number;
  blendedCostPerKg: number;
  cuts: IntakeCutPlan[];
  /** Saleable cuts with a product mapped. */
  mappedCount: number;
  /** Saleable cuts (weight > 0) with no product mapped — flagged for review. */
  unmappedCount: number;
  /** Saleable, mapped, weight > 0 cuts that will create stock. */
  stockCount: number;
};

export type IntakeMapping = {
  productId: string | null;
  updateCost?: boolean;
  updatePrice?: boolean;
};

function round(value: number, dp: number) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Build the intake plan from a successful carcass breakdown and the operator's
 * (optional) per-cut product mapping. Saleable cuts carry the blended real meat
 * cost; the loss line is marked as processing loss and never gets a product.
 */
export function buildIntakePlan(breakdown: CarcassBreakdown, mappingByCutId: Record<string, IntakeMapping> = {}): IntakePlan {
  const cuts: IntakeCutPlan[] = breakdown.rows.map((row) => {
    const mapping = mappingByCutId[row.id] ?? { productId: null };
    const isWaste = row.isWaste;
    return {
      cutId: row.id,
      cutName: row.name,
      isWaste,
      expectedWeightKg: row.weightKg,
      costPerKg: isWaste ? null : breakdown.blendedCostPerKgSaleable,
      suggestedPricePerKg: isWaste ? null : row.suggestedPricePerKg,
      marginPct: isWaste ? null : row.marginPct,
      productId: isWaste ? null : mapping.productId ?? null,
      updateCost: isWaste ? false : mapping.updateCost ?? false,
      updatePrice: isWaste ? false : mapping.updatePrice ?? false,
    };
  });

  const saleable = cuts.filter((cut) => !cut.isWaste);
  const mappedCount = saleable.filter((cut) => cut.productId).length;
  const stockCount = saleable.filter((cut) => cut.productId && cut.expectedWeightKg > 0).length;
  const unmappedCount = saleable.filter((cut) => !cut.productId && cut.expectedWeightKg > 0).length;
  const processingLossKg = round(
    cuts.filter((cut) => cut.isWaste).reduce((total, cut) => total + cut.expectedWeightKg, 0),
    3,
  );

  return {
    saleableWeightKg: breakdown.saleableKg,
    processingLossKg,
    processedWeightKg: breakdown.processedWeightKg,
    blendedCostPerKg: breakdown.blendedCostPerKgSaleable,
    cuts,
    mappedCount,
    unmappedCount,
    stockCount,
  };
}

export type IntakePreview = {
  /** Mapped saleable cuts that will create inventory stock. */
  stockLines: { cutId: string; cutName: string; weightKg: number }[];
  /** Saleable cuts (weight > 0) with no product mapped — recorded for review, no stock. */
  reviewLines: { cutId: string; cutName: string; weightKg: number }[];
  /** Bone/fat/trim/moisture recorded as processing loss (not retail waste, no stock). */
  processingLossKg: number;
  /** Linked products whose cost will be updated (review-first default). */
  costUpdates: { cutName: string; costPerKg: number }[];
  /** Linked products whose public price will be updated (explicit choice only). */
  priceUpdates: { cutName: string; pricePerKg: number }[];
};

/** Exactly what the confirmation step will do — so the preview matches the writes. */
export function buildIntakePreview(plan: IntakePlan): IntakePreview {
  const stockLines = plan.cuts
    .filter((cut) => !cut.isWaste && cut.productId && cut.expectedWeightKg > 0)
    .map((cut) => ({ cutId: cut.cutId, cutName: cut.cutName, weightKg: cut.expectedWeightKg }));

  const reviewLines = plan.cuts
    .filter((cut) => !cut.isWaste && !cut.productId && cut.expectedWeightKg > 0)
    .map((cut) => ({ cutId: cut.cutId, cutName: cut.cutName, weightKg: cut.expectedWeightKg }));

  const costUpdates = plan.cuts
    .filter((cut) => !cut.isWaste && cut.productId && cut.expectedWeightKg > 0 && cut.updateCost && cut.costPerKg != null)
    .map((cut) => ({ cutName: cut.cutName, costPerKg: cut.costPerKg as number }));

  const priceUpdates = plan.cuts
    .filter((cut) => !cut.isWaste && cut.productId && cut.expectedWeightKg > 0 && cut.updatePrice && cut.suggestedPricePerKg != null)
    .map((cut) => ({ cutName: cut.cutName, pricePerKg: cut.suggestedPricePerKg as number }));

  return { stockLines, reviewLines, processingLossKg: plan.processingLossKg, costUpdates, priceUpdates };
}

/** Shape a plan's cuts into the jsonb payload the confirm RPC expects. */
export function toRpcCuts(plan: IntakePlan) {
  return plan.cuts.map((cut) => ({
    cut_id: cut.cutId,
    cut_name: cut.cutName,
    is_waste: cut.isWaste,
    expected_weight_kg: cut.expectedWeightKg,
    cost_per_kg: cut.costPerKg,
    suggested_price_per_kg: cut.suggestedPricePerKg,
    margin_pct: cut.marginPct == null ? null : round(cut.marginPct * 100, 2),
    product_id: cut.productId,
    update_cost: cut.updateCost,
    update_price: cut.updatePrice,
  }));
}

export type IntakeFormInput = {
  intakeType: string;
  receivedWeightKg: number;
  totalCostGbp: number;
  receivedAt: string;
  expiryDate: string;
  saleableWeightKg: number;
};

/** Validate the operator's intake inputs. Returns a friendly message or null. */
export function validateIntakeInputs(input: IntakeFormInput): string | null {
  if (!INTAKE_TYPES.includes(input.intakeType as IntakeType)) {
    return "Choose how the carcass arrived (whole, side, quarter or primal).";
  }
  if (!Number.isFinite(input.receivedWeightKg) || input.receivedWeightKg <= 0) {
    return "Enter a received weight above 0kg.";
  }
  if (!Number.isFinite(input.totalCostGbp) || input.totalCostGbp <= 0) {
    return "Enter the total amount paid, above GBP 0.";
  }
  if (!Number.isFinite(input.saleableWeightKg) || input.saleableWeightKg <= 0) {
    return "This intake has no saleable cuts to receive.";
  }
  if (!input.receivedAt) return "Enter the date the carcass was received.";
  if (!input.expiryDate) return "Enter a use-by / expiry date for the stock.";
  if (input.expiryDate < input.receivedAt) return "Expiry date cannot be before the received date.";
  return null;
}
