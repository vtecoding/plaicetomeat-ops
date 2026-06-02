/**
 * Carcass breakdown calculator.
 *
 * Answers the question a new butcher can't and an experienced one does in their
 * head: "I paid £X for this whole animal — how does it cut up, what is each piece
 * worth, and what should I price it at to make money?"
 *
 * Two real-world adjustments make the cost honest:
 *  1. SHRINKAGE: a carcass loses water weight every day it hangs in the chiller,
 *     so the weight you actually cut is less than the invoice weight.
 *  2. WASTE: ~6–12% of the hung carcass is bone/fat/trim you can't sell.
 * Both push the true cost per kg of saleable meat *above* the carcass rate, which
 * is the classic rookie mistake — pricing at the carcass rate loses money on every
 * sale.
 *
 * The recorded cost is always the honest *blended* cost per kg of saleable meat —
 * the same for every cut of one animal. What varies by cut is the retail PRICE,
 * via each cut's margin. We never inflate a premium cut's "cost".
 *
 * Pure functions, no IO. All money in GBP.
 */
import type { AnimalCutSheet, BoneState, Cut, CutTier } from "./cut-sheets";

export type MarginBand = "danger" | "low" | "healthy";

/** Red below 15%, amber 15–29%, green 30%+. */
export function marginBand(marginPct: number): MarginBand {
  if (marginPct < 0.15) return "danger";
  if (marginPct < 0.3) return "low";
  return "healthy";
}

export type CutBreakdownRow = {
  id: string;
  name: string;
  bone: BoneState;
  tier: CutTier;
  bestUse: string;
  tip: string;
  isWaste: boolean;
  weightKg: number;
  marginPct: number | null;
  suggestedPricePerKg: number | null;
  lineRevenue: number | null;
  lineCost: number | null;
  lineProfit: number | null;
  band: MarginBand | null;
};

export type CarcassBreakdown = {
  ok: true;
  animalName: string;
  carcassWeightKg: number;
  carcassCost: number;
  /** What you paid per kg of raw invoice weight. */
  costPerKgCarcass: number;
  /** Days hung in the chiller before cutting. */
  daysHung: number;
  /** Water/weight lost to hanging (kg). */
  moistureLossKg: number;
  /** Weight you actually cut, after shrinkage (kg). */
  processedWeightKg: number;
  saleableKg: number;
  /** Bone/fat/trim that can't be sold (kg), from the hung carcass. */
  wasteKg: number;
  wastePct: number;
  /** The real cost per kg of meat you can actually sell — the number to price from. */
  blendedCostPerKgSaleable: number;
  rows: CutBreakdownRow[];
  totalSuggestedRevenue: number;
  totalProfit: number;
  overallMarginPct: number;
  overallBand: MarginBand;
  /** What you'd lose if you priced every cut at the carcass rate (the rookie mistake). */
  lossIfPricedAtCarcassRate: number;
};

export type CarcassBreakdownError = { ok: false; message: string };

const MAX_MARGIN = 0.95;
/** Cap total shrinkage so a silly "days hung" can't drive weight negative. */
const MAX_SHRINK_FRACTION = 0.4;

function round(value: number, dp: number) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function clampMargin(margin: number) {
  if (!Number.isFinite(margin) || margin < 0) return 0;
  return Math.min(margin, MAX_MARGIN);
}

export function calculateCarcassBreakdown(input: {
  sheet: AnimalCutSheet;
  carcassWeightKg: number;
  carcassCost: number;
  /** Days the carcass hung in the chiller (default 0 = processed immediately). */
  daysHung?: number;
  /** Optional per-cut margin overrides, keyed by cut id (0..1). */
  marginOverrides?: Record<string, number>;
}): CarcassBreakdown | CarcassBreakdownError {
  const { sheet, carcassWeightKg, carcassCost, marginOverrides } = input;

  if (!Number.isFinite(carcassWeightKg) || carcassWeightKg <= 0) {
    return { ok: false, message: "Enter the carcass weight in kg." };
  }
  if (!Number.isFinite(carcassCost) || carcassCost < 0) {
    return { ok: false, message: "Enter what you paid for the carcass." };
  }

  // 1. Shrinkage — weight lost while hanging in the chiller.
  const daysHung = Number.isFinite(input.daysHung) && (input.daysHung ?? 0) > 0 ? (input.daysHung as number) : 0;
  const shrinkFraction = Math.min(daysHung * sheet.dailyShrinkagePct, MAX_SHRINK_FRACTION);
  const moistureLossKg = carcassWeightKg * shrinkFraction;
  const processedWeightKg = carcassWeightKg - moistureLossKg;

  const costPerKgCarcass = carcassCost / carcassWeightKg;

  // 2. Yields apply to the weight you actually cut (post-shrinkage).
  const saleableKg = sheet.cuts
    .filter((cut) => !cut.isWaste)
    .reduce((total, cut) => total + processedWeightKg * cut.yieldPct, 0);
  const wasteKg = processedWeightKg - saleableKg;

  if (saleableKg <= 0) {
    return { ok: false, message: "This animal has no saleable cuts configured." };
  }

  const blendedCostPerKgSaleable = carcassCost / saleableKg;

  const rows: CutBreakdownRow[] = sheet.cuts.map((cut: Cut) => {
    const weightKg = processedWeightKg * cut.yieldPct;

    if (cut.isWaste) {
      return {
        id: cut.id,
        name: cut.name,
        bone: cut.bone,
        tier: cut.tier,
        bestUse: cut.bestUse,
        tip: cut.tip,
        isWaste: true,
        weightKg: round(weightKg, 2),
        marginPct: null,
        suggestedPricePerKg: null,
        lineRevenue: null,
        lineCost: null,
        lineProfit: null,
        band: null,
      };
    }

    const margin = clampMargin(marginOverrides?.[cut.id] ?? cut.defaultMarginPct);
    const suggestedPricePerKg = blendedCostPerKgSaleable / (1 - margin);
    const lineRevenue = weightKg * suggestedPricePerKg;
    const lineCost = weightKg * blendedCostPerKgSaleable;

    return {
      id: cut.id,
      name: cut.name,
      bone: cut.bone,
      tier: cut.tier,
      bestUse: cut.bestUse,
      tip: cut.tip,
      isWaste: false,
      weightKg: round(weightKg, 2),
      marginPct: round(margin, 3),
      suggestedPricePerKg: round(suggestedPricePerKg, 2),
      lineRevenue: round(lineRevenue, 2),
      lineCost: round(lineCost, 2),
      lineProfit: round(lineRevenue - lineCost, 2),
      band: marginBand(margin),
    };
  });

  const totalSuggestedRevenue = rows.reduce((total, row) => total + (row.lineRevenue ?? 0), 0);
  const totalProfit = totalSuggestedRevenue - carcassCost;
  const overallMarginRatio = totalSuggestedRevenue > 0 ? totalProfit / totalSuggestedRevenue : 0;
  const revenueIfPricedAtCarcassRate = saleableKg * costPerKgCarcass;
  const lossIfPricedAtCarcassRate = carcassCost - revenueIfPricedAtCarcassRate;

  return {
    ok: true,
    animalName: sheet.animal,
    carcassWeightKg: round(carcassWeightKg, 2),
    carcassCost: round(carcassCost, 2),
    costPerKgCarcass: round(costPerKgCarcass, 2),
    daysHung,
    moistureLossKg: round(moistureLossKg, 3),
    processedWeightKg: round(processedWeightKg, 2),
    saleableKg: round(saleableKg, 2),
    wasteKg: round(wasteKg, 2),
    wastePct: round((wasteKg / processedWeightKg) * 100, 1),
    blendedCostPerKgSaleable: round(blendedCostPerKgSaleable, 2),
    rows,
    totalSuggestedRevenue: round(totalSuggestedRevenue, 2),
    totalProfit: round(totalProfit, 2),
    overallMarginPct: round(overallMarginRatio * 100, 1),
    overallBand: marginBand(overallMarginRatio),
    lossIfPricedAtCarcassRate: round(lossIfPricedAtCarcassRate, 2),
  };
}
