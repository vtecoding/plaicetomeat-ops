/**
 * Carcass breakdown calculator.
 *
 * Answers the question a new butcher can't and an experienced one does in their
 * head: "I paid £X for this whole animal — how does it cut up, what is each piece
 * worth, and what should I price it at to make money?"
 *
 * The single most important number it surfaces is the BLENDED cost per kg of
 * *saleable* meat. Because ~6–12% of a carcass is bone/fat/trim loss, the meat
 * actually costs more per kg than the carcass did — pricing at the carcass rate
 * is the classic rookie mistake that loses money on every sale.
 *
 * Pure functions, no IO. All money in GBP.
 */
import type { AnimalCutSheet, BoneState, Cut, CutTier } from "./cut-sheets";

export type CutBreakdownRow = {
  id: string;
  name: string;
  bone: BoneState;
  tier: CutTier;
  bestUse: string;
  tip: string;
  isWaste: boolean;
  weightKg: number;
  /** Target margin used for this row (0..1). Null for the waste line. */
  marginPct: number | null;
  /** Suggested retail price per kg to hit the target margin. Null for waste. */
  suggestedPricePerKg: number | null;
  /** Revenue if the whole cut sells at the suggested price. Null for waste. */
  lineRevenue: number | null;
  /** Allocated cost of this cut (blended saleable cost). Null for waste. */
  lineCost: number | null;
  /** lineRevenue - lineCost. Null for waste. */
  lineProfit: number | null;
};

export type CarcassBreakdown = {
  ok: true;
  animalName: string;
  carcassWeightKg: number;
  carcassCost: number;
  /** What you paid per kg for the whole carcass. */
  costPerKgCarcass: number;
  saleableKg: number;
  wasteKg: number;
  wastePct: number;
  /** The real cost per kg of meat you can actually sell — the number to price from. */
  blendedCostPerKgSaleable: number;
  rows: CutBreakdownRow[];
  totalSuggestedRevenue: number;
  totalProfit: number;
  overallMarginPct: number;
  /** What you'd lose if you priced every cut at the carcass rate (the rookie mistake). */
  lossIfPricedAtCarcassRate: number;
};

export type CarcassBreakdownError = { ok: false; message: string };

const MAX_MARGIN = 0.95;

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

  const costPerKgCarcass = carcassCost / carcassWeightKg;

  const saleableKg = sheet.cuts
    .filter((cut) => !cut.isWaste)
    .reduce((total, cut) => total + carcassWeightKg * cut.yieldPct, 0);
  const wasteKg = carcassWeightKg - saleableKg;

  // Guard against a malformed sheet (no saleable meat).
  if (saleableKg <= 0) {
    return { ok: false, message: "This animal has no saleable cuts configured." };
  }

  const blendedCostPerKgSaleable = carcassCost / saleableKg;

  const rows: CutBreakdownRow[] = sheet.cuts.map((cut: Cut) => {
    const weightKg = carcassWeightKg * cut.yieldPct;

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
    };
  });

  const totalSuggestedRevenue = rows.reduce((total, row) => total + (row.lineRevenue ?? 0), 0);
  const totalProfit = totalSuggestedRevenue - carcassCost;
  const overallMarginPct = totalSuggestedRevenue > 0 ? totalProfit / totalSuggestedRevenue : 0;
  const revenueIfPricedAtCarcassRate = saleableKg * costPerKgCarcass;
  const lossIfPricedAtCarcassRate = carcassCost - revenueIfPricedAtCarcassRate;

  return {
    ok: true,
    animalName: sheet.animal,
    carcassWeightKg: round(carcassWeightKg, 2),
    carcassCost: round(carcassCost, 2),
    costPerKgCarcass: round(costPerKgCarcass, 2),
    saleableKg: round(saleableKg, 2),
    wasteKg: round(wasteKg, 2),
    wastePct: round((wasteKg / carcassWeightKg) * 100, 1),
    blendedCostPerKgSaleable: round(blendedCostPerKgSaleable, 2),
    rows,
    totalSuggestedRevenue: round(totalSuggestedRevenue, 2),
    totalProfit: round(totalProfit, 2),
    overallMarginPct: round(overallMarginPct * 100, 1),
    lossIfPricedAtCarcassRate: round(lossIfPricedAtCarcassRate, 2),
  };
}
