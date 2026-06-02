import { canonicalAnimalType, findCutMapRegion, getToolGuidance, normalizeCutKey } from "./cut-map-data";

export type GuardrailSeverity = "info" | "warning";
export type YieldStatus = "normal" | "low_yield" | "high_yield" | "missing_reference" | "invalid_weight";

export type YieldReference = {
  animalType: string;
  cutKey: string;
  expectedMinPct: number;
  expectedMaxPct: number;
  severityBelowMin: GuardrailSeverity;
  severityAboveMax: GuardrailSeverity;
};

export type RecordedCutForGuardrail = {
  id: string;
  name: string;
  weightKg: number;
  isWaste?: boolean;
  marginPct?: number | null;
  band?: "danger" | "low" | "healthy" | null;
  bestUse?: string;
  tier?: string;
};

export type YieldAssessment = {
  cutId: string;
  cutName: string;
  actualYieldPct: number | null;
  expectedMinPct: number | null;
  expectedMaxPct: number | null;
  status: YieldStatus;
  severity: GuardrailSeverity;
  explanation: string;
};

export type MassIntegrity = {
  ok: boolean;
  rawWeightKg: number;
  moistureLossKg: number;
  saleableKg: number;
  wasteKg: number;
  allocatedKg: number;
  unallocatedKg: number;
  explanation: string;
};

export type RetailTip = {
  cutId: string;
  cutName: string;
  message: string;
  reason: string;
};

const YIELD_REFERENCES: readonly YieldReference[] = [
  ref("lamb", "leg", 28, 34, "warning", "info"),
  ref("lamb", "shoulder", 16, 22, "warning", "info"),
  ref("lamb", "loin-chops", 7, 11, "warning", "info"),
  ref("lamb", "rack", 6, 10, "warning", "info"),
  ref("lamb", "breast", 7, 11, "warning", "info"),
  ref("lamb", "neck", 5, 9, "warning", "info"),
  ref("lamb", "shanks", 4, 7, "warning", "info"),
  ref("lamb", "mince-trim", 5, 10, "info", "warning"),
  ref("lamb", "waste", 4, 9, "info", "warning"),

  ref("goat", "leg", 27, 33, "warning", "info"),
  ref("goat", "shoulder", 17, 23, "warning", "info"),
  ref("goat", "ribs-chops", 9, 15, "warning", "info"),
  ref("goat", "loin", 6, 10, "warning", "info"),
  ref("goat", "neck", 6, 10, "warning", "info"),
  ref("goat", "shanks", 4, 8, "warning", "info"),
  ref("goat", "curry-mince", 6, 11, "info", "warning"),
  ref("goat", "waste", 6, 11, "info", "warning"),

  ref("beef", "chuck", 20, 26, "warning", "info"),
  ref("beef", "brisket", 5, 9, "warning", "info"),
  ref("beef", "rib", 6, 10, "warning", "info"),
  ref("beef", "sirloin", 5, 9, "warning", "info"),
  ref("beef", "rump", 4, 8, "warning", "info"),
  ref("beef", "topside", 9, 13, "warning", "info"),
  ref("beef", "silverside", 7, 11, "warning", "info"),
  ref("beef", "flank", 5, 9, "warning", "info"),
  ref("beef", "shin", 3, 7, "warning", "info"),
  ref("beef", "mince-trim", 5, 10, "info", "warning"),
  ref("beef", "waste", 7, 13, "info", "warning"),

  ref("chicken", "breast", 24, 32, "warning", "info"),
  ref("chicken", "thigh", 15, 21, "warning", "info"),
  ref("chicken", "drumstick", 12, 18, "warning", "info"),
  ref("chicken", "wing", 8, 14, "warning", "info"),
  ref("chicken", "carcass", 16, 24, "info", "warning"),
  ref("chicken", "waste", 5, 11, "info", "warning"),
] as const;

function ref(
  animalType: string,
  cutKey: string,
  expectedMinPct: number,
  expectedMaxPct: number,
  severityBelowMin: GuardrailSeverity,
  severityAboveMax: GuardrailSeverity,
): YieldReference {
  return { animalType, cutKey, expectedMinPct, expectedMaxPct, severityBelowMin, severityAboveMax };
}

function round(value: number, dp: number) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function formatKg(value: number) {
  return `${round(Math.abs(value), 2)}kg`;
}

function formatRange(min: number, max: number) {
  return `${min}-${max}%`;
}

export function calculateYieldPercentage(cutWeightKg: number, baseWeightKg: number): number | null {
  if (!Number.isFinite(cutWeightKg) || !Number.isFinite(baseWeightKg) || cutWeightKg < 0 || baseWeightKg <= 0) {
    return null;
  }
  return round((cutWeightKg / baseWeightKg) * 100, 1);
}

export function findYieldReference(animalType: string, cutIdOrName: string): YieldReference | null {
  const canonical = canonicalAnimalType(animalType);
  if (!canonical) return null;

  const key = normalizeCutKey(cutIdOrName);
  return (
    YIELD_REFERENCES.find((reference) => {
      if (reference.animalType !== canonical) return false;
      return normalizeCutKey(reference.cutKey) === key;
    }) ?? null
  );
}

export function evaluateYieldGuardrail(input: {
  animalType: string;
  cutId: string;
  cutName: string;
  cutWeightKg: number;
  processedWeightKg: number;
}): YieldAssessment {
  const actualYieldPct = calculateYieldPercentage(input.cutWeightKg, input.processedWeightKg);
  if (actualYieldPct === null) {
    return {
      cutId: input.cutId,
      cutName: input.cutName,
      actualYieldPct: null,
      expectedMinPct: null,
      expectedMaxPct: null,
      status: "invalid_weight",
      severity: "warning",
      explanation: `${input.cutName} yield cannot be checked because the recorded weight or base weight is invalid.`,
    };
  }

  const reference = findYieldReference(input.animalType, input.cutId) ?? findYieldReference(input.animalType, input.cutName);
  if (!reference) {
    return {
      cutId: input.cutId,
      cutName: input.cutName,
      actualYieldPct,
      expectedMinPct: null,
      expectedMaxPct: null,
      status: "missing_reference",
      severity: "info",
      explanation: `No yield reference exists for ${input.cutName} yet.`,
    };
  }

  if (actualYieldPct < reference.expectedMinPct) {
    return {
      cutId: input.cutId,
      cutName: input.cutName,
      actualYieldPct,
      expectedMinPct: reference.expectedMinPct,
      expectedMaxPct: reference.expectedMaxPct,
      status: "low_yield",
      severity: reference.severityBelowMin,
      explanation: `${input.cutName} yield is ${actualYieldPct}%, below the expected ${formatRange(
        reference.expectedMinPct,
        reference.expectedMaxPct,
      )} range. Check trimming loss before saving.`,
    };
  }

  if (actualYieldPct > reference.expectedMaxPct) {
    return {
      cutId: input.cutId,
      cutName: input.cutName,
      actualYieldPct,
      expectedMinPct: reference.expectedMinPct,
      expectedMaxPct: reference.expectedMaxPct,
      status: "high_yield",
      severity: reference.severityAboveMax,
      explanation: `${input.cutName} yield is ${actualYieldPct}%, above the expected ${formatRange(
        reference.expectedMinPct,
        reference.expectedMaxPct,
      )} range. Check that waste, bone and trim have not been hidden in this cut.`,
    };
  }

  return {
    cutId: input.cutId,
    cutName: input.cutName,
    actualYieldPct,
    expectedMinPct: reference.expectedMinPct,
    expectedMaxPct: reference.expectedMaxPct,
    status: "normal",
    severity: "info",
    explanation: `${input.cutName} yield is within the expected ${formatRange(reference.expectedMinPct, reference.expectedMaxPct)} range.`,
  };
}

export function calculateMassIntegrity(input: {
  rawWeightKg: number;
  moistureLossKg: number;
  cuts: readonly RecordedCutForGuardrail[];
  toleranceKg?: number;
}): MassIntegrity {
  const rawWeightKg = Number.isFinite(input.rawWeightKg) ? input.rawWeightKg : 0;
  const moistureLossKg = Number.isFinite(input.moistureLossKg) ? Math.max(0, input.moistureLossKg) : 0;
  const toleranceKg = input.toleranceKg ?? 0.05;
  const saleableKg = input.cuts.filter((cut) => !cut.isWaste).reduce((total, cut) => total + safeWeight(cut.weightKg), 0);
  const wasteKg = input.cuts.filter((cut) => cut.isWaste).reduce((total, cut) => total + safeWeight(cut.weightKg), 0);
  const allocatedKg = moistureLossKg + saleableKg + wasteKg;
  const unallocatedKg = round(rawWeightKg - allocatedKg, 2);
  const ok = Math.abs(unallocatedKg) <= toleranceKg;

  let explanation = "Raw weight is accounted for by shrinkage, saleable cuts and waste/trimming allocation.";
  if (!ok && unallocatedKg > 0) {
    explanation = `${formatKg(unallocatedKg)} is currently unallocated. Pricing may be inaccurate.`;
  } else if (!ok) {
    explanation = `${formatKg(unallocatedKg)} is currently over-allocated. Pricing may be inaccurate.`;
  }

  return {
    ok,
    rawWeightKg: round(rawWeightKg, 2),
    moistureLossKg: round(moistureLossKg, 2),
    saleableKg: round(saleableKg, 2),
    wasteKg: round(wasteKg, 2),
    allocatedKg: round(allocatedKg, 2),
    unallocatedKg,
    explanation,
  };
}

function safeWeight(weightKg: number) {
  return Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 0;
}

export function calculateYieldGuardrails(input: {
  animalType: string;
  rawWeightKg: number;
  processedWeightKg: number;
  moistureLossKg: number;
  cuts: readonly RecordedCutForGuardrail[];
}) {
  return {
    assessments: input.cuts.map((cut) =>
      evaluateYieldGuardrail({
        animalType: input.animalType,
        cutId: cut.id,
        cutName: cut.name,
        cutWeightKg: cut.weightKg,
        processedWeightKg: input.processedWeightKg,
      }),
    ),
    massIntegrity: calculateMassIntegrity({
      rawWeightKg: input.rawWeightKg,
      moistureLossKg: input.moistureLossKg,
      cuts: input.cuts,
    }),
  };
}

export function hasCutMapFallback(animalType: string, cutIdOrName: string) {
  return findCutMapRegion(animalType, cutIdOrName) === null;
}

export function hasToolFallback(cutIdOrName: string) {
  return getToolGuidance(cutIdOrName) === null;
}

export function generateRetailTips(input: {
  animalType: string;
  cuts: readonly RecordedCutForGuardrail[];
  assessments?: readonly YieldAssessment[];
}): RetailTip[] {
  const tips: RetailTip[] = [];
  const assessmentByCut = new Map((input.assessments ?? []).map((assessment) => [assessment.cutId, assessment]));

  for (const cut of input.cuts) {
    if (cut.isWaste) {
      if (cut.weightKg > 0) {
        tips.push({
          cutId: cut.id,
          cutName: cut.name,
          message: `${cut.name}: keep waste, bone and trim visible in the breakdown before pricing saleable cuts.`,
          reason: `Appeared because ${cut.name} is marked as a waste/trimming allocation.`,
        });
      }
      continue;
    }

    const key = normalizeCutKey(cut.id);
    const assessment = assessmentByCut.get(cut.id);

    if (assessment?.status === "low_yield") {
      tips.push({
        cutId: cut.id,
        cutName: cut.name,
        message: `${cut.name} is yielding low: check trimming loss before using discounting to move stock.`,
        reason: `Appeared because actual yield is below the expected range for this cut.`,
      });
    }

    if (assessment?.status === "high_yield") {
      tips.push({
        cutId: cut.id,
        cutName: cut.name,
        message: `${cut.name} yield is high: confirm waste and bone allocation before treating the margin as real.`,
        reason: `Appeared because actual yield is above the expected range for this cut.`,
      });
    }

    if (key.includes("mince") || key.includes("trim")) {
      tips.push({
        cutId: cut.id,
        cutName: cut.name,
        message: `${cut.name} surplus: consider kofta, kebab or burger packs rather than discounting plain mince.`,
        reason: `Appeared because this cut is recorded as mince or trim.`,
      });
    }

    if (cut.band === "danger" || (typeof cut.marginPct === "number" && cut.marginPct < 0.15)) {
      tips.push({
        cutId: cut.id,
        cutName: cut.name,
        message: `Low margin on ${cut.name}: review price before selling it as display stock.`,
        reason: `Appeared because the cut margin is below 15%.`,
      });
    }

    if (cut.tier === "premium" && (cut.band === "low" || cut.band === "danger")) {
      tips.push({
        cutId: cut.id,
        cutName: cut.name,
        message: `${cut.name} is premium but margin is weak: review portion size and price before display.`,
        reason: `Appeared because this premium cut is not in the healthy margin band.`,
      });
    }

    if (key.includes("wing") || key.includes("drumstick") || key.includes("chop") || key.includes("rack")) {
      tips.push({
        cutId: cut.id,
        cutName: cut.name,
        message: `${cut.name}: consider stronger display placement for BBQ-style packs when demand is already present.`,
        reason: `Appeared because this is a quick-cook or BBQ-friendly cut; no weather or local demand data was used.`,
      });
    }
  }

  return tips.slice(0, 5);
}
