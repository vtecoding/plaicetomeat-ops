import { describe, expect, it } from "vitest";

import {
  buildSystemRecommendation,
  classifyVariance,
  computeVariancePct,
  defaultCarcassInput,
  expectedCutIds,
  SPECIES_IDS,
  summariseOverallSignoff,
  summariseSpeciesVerdict,
  type PricingValidationRecord,
} from "./pricing-validation";

function record(partial: Partial<PricingValidationRecord> & Pick<PricingValidationRecord, "species" | "cutId" | "decision">): PricingValidationRecord {
  return {
    cutName: partial.cutId,
    systemYieldPct: 0.3,
    systemCostPerKg: 10,
    systemPricePerKg: 15,
    systemMarginPct: 0.33,
    butcherYieldPct: partial.decision === "pending" ? null : 0.3,
    butcherPricePerKg: partial.decision === "pending" ? null : 15,
    variancePct: null,
    notes: null,
    butcherName: null,
    reviewedAt: null,
    ...partial,
  };
}

describe("buildSystemRecommendation", () => {
  it("returns one row per saleable cut (waste excluded) for each species", () => {
    for (const species of SPECIES_IDS) {
      const { carcassWeightKg, carcassCost } = defaultCarcassInput(species);
      const rows = buildSystemRecommendation({ species, carcassWeightKg, carcassCost });
      expect(rows, species).not.toBeNull();
      expect(rows!.length, species).toBe(expectedCutIds(species).length);
      expect(rows!.some((r) => r.cutId === "waste")).toBe(false);
    }
  });

  it("prices every saleable cut above the blended saleable cost (never loss-making)", () => {
    const { carcassWeightKg, carcassCost } = defaultCarcassInput("lamb");
    const rows = buildSystemRecommendation({ species: "lamb", carcassWeightKg, carcassCost })!;
    for (const row of rows) {
      expect(row.suggestedPricePerKg).toBeGreaterThan(row.costPerKgSaleable);
      expect(row.marginPct).toBeGreaterThan(0);
    }
  });

  it("returns null for zero carcass weight (invalid breakdown)", () => {
    expect(buildSystemRecommendation({ species: "beef", carcassWeightKg: 0, carcassCost: 100 })).toBeNull();
  });
});

describe("computeVariancePct", () => {
  it("matches the server formula (butcher - system)/system*100", () => {
    expect(computeVariancePct(10, 11)).toBe(10);
    expect(computeVariancePct(10, 9)).toBe(-10);
    expect(computeVariancePct(20, 20)).toBe(0);
  });

  it("is null when the butcher price is missing or system price is zero", () => {
    expect(computeVariancePct(10, null)).toBeNull();
    expect(computeVariancePct(0, 5)).toBeNull();
  });
});

describe("classifyVariance", () => {
  it("bands by magnitude", () => {
    expect(classifyVariance(null)).toBe("unknown");
    expect(classifyVariance(3)).toBe("aligned");
    expect(classifyVariance(-5)).toBe("aligned");
    expect(classifyVariance(12)).toBe("minor");
    expect(classifyVariance(-15)).toBe("minor");
    expect(classifyVariance(40)).toBe("major");
  });
});

describe("summariseSpeciesVerdict", () => {
  it("is INCOMPLETE when no cuts are reviewed", () => {
    const v = summariseSpeciesVerdict("lamb", []);
    expect(v.verdict).toBe("INCOMPLETE");
    expect(v.reviewedCount).toBe(0);
    expect(v.outstandingCutIds.length).toBe(v.totalExpected);
  });

  it("is APPROVED only when every saleable cut is approved", () => {
    const records = expectedCutIds("lamb").map((cutId) => record({ species: "lamb", cutId, decision: "approved" }));
    const v = summariseSpeciesVerdict("lamb", records);
    expect(v.verdict).toBe("APPROVED");
    expect(v.approvedCount).toBe(v.totalExpected);
    expect(v.outstandingCutIds).toEqual([]);
  });

  it("is CHANGES_REQUIRED if any reviewed cut needs changes, even with others approved", () => {
    const cuts = expectedCutIds("lamb");
    const records = cuts.map((cutId, i) =>
      record({ species: "lamb", cutId, decision: i === 0 ? "changes_required" : "approved" }),
    );
    const v = summariseSpeciesVerdict("lamb", records);
    expect(v.verdict).toBe("CHANGES_REQUIRED");
    expect(v.changesCount).toBe(1);
  });

  it("is INCOMPLETE when some cuts are still pending", () => {
    const cuts = expectedCutIds("goat");
    const records = cuts.slice(1).map((cutId) => record({ species: "goat", cutId, decision: "approved" }));
    const v = summariseSpeciesVerdict("goat", records);
    expect(v.verdict).toBe("INCOMPLETE");
    expect(v.outstandingCutIds).toContain(cuts[0]);
  });
});

describe("summariseOverallSignoff", () => {
  it("is INCOMPLETE with no records", () => {
    expect(summariseOverallSignoff([]).verdict).toBe("INCOMPLETE");
  });

  it("CHANGES_REQUIRED dominates a single rejected assumption (launch FAIL)", () => {
    const records: PricingValidationRecord[] = [];
    for (const species of SPECIES_IDS) {
      for (const cutId of expectedCutIds(species)) {
        records.push(record({ species, cutId, decision: "approved" }));
      }
    }
    records[0].decision = "changes_required";
    expect(summariseOverallSignoff(records).verdict).toBe("CHANGES_REQUIRED");
  });

  it("APPROVED only when every saleable cut of every species is approved", () => {
    const records: PricingValidationRecord[] = [];
    for (const species of SPECIES_IDS) {
      for (const cutId of expectedCutIds(species)) {
        records.push(record({ species, cutId, decision: "approved" }));
      }
    }
    const overall = summariseOverallSignoff(records);
    expect(overall.verdict).toBe("APPROVED");
    expect(overall.approvedCount).toBe(overall.totalExpected);
  });
});
