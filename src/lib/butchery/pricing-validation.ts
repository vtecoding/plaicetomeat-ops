/**
 * Butcher economics validation (V13.1) — pure domain layer.
 *
 * Builds the "System Recommendation" a real butcher reviews (per-cut yield, blended
 * saleable cost, suggested price and target margin) from the existing carcass
 * breakdown engine, and summarises the butcher's captured verdicts into an overall
 * sign-off. No IO, no pricing changes — this only describes and scores assumptions.
 *
 * All money in GBP. Yields and margins are fractions (0..1).
 */
import { calculateCarcassBreakdown } from "./carcass-breakdown";
import { CUT_SHEETS, getCutSheet } from "./cut-sheets";

export type SpeciesId = "lamb" | "goat" | "beef" | "chicken";

export const SPECIES_IDS: readonly SpeciesId[] = ["lamb", "goat", "beef", "chicken"];

/**
 * Sensible default *dressed-carcass* cost per kg to pre-fill the calculator (GBP/kg).
 * These are editable starting assumptions for the review, never fixed prices — the
 * whole point of V13.1 is for a real butcher to correct them.
 */
export const DEFAULT_CARCASS_COST_PER_KG: Record<SpeciesId, number> = {
  lamb: 8.5,
  goat: 8.0,
  beef: 6.5,
  chicken: 3.2,
};

export type SystemCutRecommendation = {
  cutId: string;
  cutName: string;
  /** Share of carcass weight, 0..1. */
  yieldPct: number;
  /** Blended cost per kg of saleable meat — the same for every cut of one animal. */
  costPerKgSaleable: number;
  /** System's suggested retail price per kg for this cut. */
  suggestedPricePerKg: number;
  /** Target gross margin for this cut, 0..1. */
  marginPct: number;
};

export type PricingValidationDecision = "pending" | "approved" | "changes_required";

export type PricingValidationRecord = {
  species: SpeciesId;
  cutId: string;
  cutName: string;
  systemYieldPct: number;
  systemCostPerKg: number;
  systemPricePerKg: number;
  systemMarginPct: number;
  butcherYieldPct: number | null;
  butcherPricePerKg: number | null;
  variancePct: number | null;
  decision: PricingValidationDecision;
  notes: string | null;
  butcherName: string | null;
  reviewedAt: string | null;
};

export type VarianceBand = "unknown" | "aligned" | "minor" | "major";

export type SignoffVerdict = "APPROVED" | "CHANGES_REQUIRED" | "INCOMPLETE";

function round(value: number, dp: number) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** The non-waste cut ids a full sign-off must cover, per species. */
export function expectedCutIds(species: SpeciesId): string[] {
  const sheet = getCutSheet(species);
  if (!sheet) return [];
  return sheet.cuts.filter((cut) => !cut.isWaste).map((cut) => cut.id);
}

/** Default carcass weight + cost to pre-fill a species' review. */
export function defaultCarcassInput(species: SpeciesId): { carcassWeightKg: number; carcassCost: number } {
  const sheet = getCutSheet(species);
  const weightKg = sheet?.typicalCarcassKg ?? 0;
  const carcassCost = round(weightKg * DEFAULT_CARCASS_COST_PER_KG[species], 2);
  return { carcassWeightKg: weightKg, carcassCost };
}

/**
 * Build the system's per-cut recommendation for a species from the carcass breakdown.
 * Waste lines are excluded — a butcher signs off saleable cuts. Returns null if the
 * species is unknown or the breakdown is invalid (e.g. zero weight).
 */
export function buildSystemRecommendation(input: {
  species: SpeciesId;
  carcassWeightKg: number;
  carcassCost: number;
  daysHung?: number;
}): SystemCutRecommendation[] | null {
  const sheet = getCutSheet(input.species);
  if (!sheet) return null;

  const breakdown = calculateCarcassBreakdown({
    sheet,
    carcassWeightKg: input.carcassWeightKg,
    carcassCost: input.carcassCost,
    daysHung: input.daysHung,
  });
  if (!breakdown.ok) return null;

  return breakdown.rows
    .filter((row) => !row.isWaste && row.suggestedPricePerKg !== null && row.marginPct !== null)
    .map((row) => ({
      cutId: row.id,
      cutName: row.name,
      yieldPct: round(row.weightKg / breakdown.processedWeightKg, 4),
      costPerKgSaleable: breakdown.blendedCostPerKgSaleable,
      suggestedPricePerKg: row.suggestedPricePerKg as number,
      marginPct: row.marginPct as number,
    }));
}

/**
 * Price variance of the butcher's figure vs the system's, as a percentage. Mirrors
 * the server-side formula in record_pricing_validation so the UI preview matches the
 * stored value. Positive = butcher prices higher than the system.
 */
export function computeVariancePct(systemPricePerKg: number, butcherPricePerKg: number | null): number | null {
  if (butcherPricePerKg === null || !Number.isFinite(butcherPricePerKg)) return null;
  if (!Number.isFinite(systemPricePerKg) || systemPricePerKg === 0) return null;
  return round(((butcherPricePerKg - systemPricePerKg) / systemPricePerKg) * 100, 1);
}

/** Classify a price variance into a tolerance band (|v| ≤5% aligned, ≤15% minor, else major). */
export function classifyVariance(variancePct: number | null): VarianceBand {
  if (variancePct === null || !Number.isFinite(variancePct)) return "unknown";
  const magnitude = Math.abs(variancePct);
  if (magnitude <= 5) return "aligned";
  if (magnitude <= 15) return "minor";
  return "major";
}

export type SpeciesVerdict = {
  species: SpeciesId;
  verdict: SignoffVerdict;
  totalExpected: number;
  reviewedCount: number;
  approvedCount: number;
  changesCount: number;
  /** Expected cuts with no recorded verdict yet (still pending / missing). */
  outstandingCutIds: string[];
};

/**
 * Verdict for one species:
 *   CHANGES_REQUIRED if any reviewed cut needs changes;
 *   INCOMPLETE if any expected cut is unreviewed or still pending;
 *   APPROVED only when every expected saleable cut is approved.
 */
export function summariseSpeciesVerdict(species: SpeciesId, records: readonly PricingValidationRecord[]): SpeciesVerdict {
  const expected = expectedCutIds(species);
  const byCut = new Map(records.filter((r) => r.species === species).map((r) => [r.cutId, r] as const));

  let approvedCount = 0;
  let changesCount = 0;
  const outstandingCutIds: string[] = [];

  for (const cutId of expected) {
    const record = byCut.get(cutId);
    if (!record || record.decision === "pending") {
      outstandingCutIds.push(cutId);
      continue;
    }
    if (record.decision === "approved") approvedCount += 1;
    else if (record.decision === "changes_required") changesCount += 1;
  }

  const reviewedCount = approvedCount + changesCount;
  let verdict: SignoffVerdict;
  if (changesCount > 0) verdict = "CHANGES_REQUIRED";
  else if (outstandingCutIds.length > 0) verdict = "INCOMPLETE";
  else verdict = "APPROVED";

  return {
    species,
    verdict,
    totalExpected: expected.length,
    reviewedCount,
    approvedCount,
    changesCount,
    outstandingCutIds,
  };
}

export type OverallSignoff = {
  verdict: SignoffVerdict;
  bySpecies: SpeciesVerdict[];
  totalExpected: number;
  reviewedCount: number;
  approvedCount: number;
  changesCount: number;
};

/**
 * Overall programme verdict across all species. CHANGES_REQUIRED dominates (a single
 * rejected assumption is a launch FAIL per the V13 spec); otherwise every saleable cut
 * of every species must be approved for an APPROVED sign-off.
 */
export function summariseOverallSignoff(records: readonly PricingValidationRecord[]): OverallSignoff {
  const bySpecies = SPECIES_IDS.map((species) => summariseSpeciesVerdict(species, records));

  const totals = bySpecies.reduce(
    (acc, s) => ({
      totalExpected: acc.totalExpected + s.totalExpected,
      reviewedCount: acc.reviewedCount + s.reviewedCount,
      approvedCount: acc.approvedCount + s.approvedCount,
      changesCount: acc.changesCount + s.changesCount,
    }),
    { totalExpected: 0, reviewedCount: 0, approvedCount: 0, changesCount: 0 },
  );

  let verdict: SignoffVerdict;
  if (totals.changesCount > 0) verdict = "CHANGES_REQUIRED";
  else if (totals.approvedCount === totals.totalExpected && totals.totalExpected > 0) verdict = "APPROVED";
  else verdict = "INCOMPLETE";

  return { verdict, bySpecies, ...totals };
}

/** Display label for a species id. */
export function speciesLabel(species: SpeciesId): string {
  return getCutSheet(species)?.animal ?? species;
}

/** All species the validation surface covers, with their cut sheets. */
export function validationSpecies() {
  return SPECIES_IDS.map((id) => CUT_SHEETS.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
}
