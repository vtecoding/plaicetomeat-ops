import { describe, expect, it } from "vitest";

import { findCutMapRegion, getToolGuidance } from "./cut-map-data";
import {
  calculateMassIntegrity,
  calculateYieldPercentage,
  evaluateYieldGuardrail,
  generateRetailTips,
  hasCutMapFallback,
  hasToolFallback,
} from "./yield-guardrails";

describe("yield guardrails", () => {
  it("calculates yield percentage from cut weight and processed weight", () => {
    expect(calculateYieldPercentage(1.4, 20)).toBe(7);
  });

  it("flags a below-range warning", () => {
    const result = evaluateYieldGuardrail({
      animalType: "lamb",
      cutId: "rack",
      cutName: "Rack / best end",
      cutWeightKg: 0.76,
      processedWeightKg: 20,
    });

    expect(result.status).toBe("low_yield");
    expect(result.severity).toBe("warning");
    expect(result.explanation).toContain("below the expected 6-10% range");
  });

  it("flags an above-range info status where the reference allows it", () => {
    const result = evaluateYieldGuardrail({
      animalType: "lamb",
      cutId: "rack",
      cutName: "Rack / best end",
      cutWeightKg: 2.4,
      processedWeightKg: 20,
    });

    expect(result.status).toBe("high_yield");
    expect(result.severity).toBe("info");
    expect(result.explanation).toContain("above the expected 6-10% range");
  });

  it("reports normal range", () => {
    const result = evaluateYieldGuardrail({
      animalType: "lamb",
      cutId: "rack",
      cutName: "Rack / best end",
      cutWeightKg: 1.4,
      processedWeightKg: 20,
    });

    expect(result.status).toBe("normal");
    expect(result.explanation).toContain("within the expected 6-10% range");
  });

  it("handles missing references", () => {
    const result = evaluateYieldGuardrail({
      animalType: "lamb",
      cutId: "new-special-cut",
      cutName: "New special cut",
      cutWeightKg: 1,
      processedWeightKg: 20,
    });

    expect(result.status).toBe("missing_reference");
    expect(result.severity).toBe("info");
    expect(result.explanation).toContain("No yield reference exists");
  });

  it("warns on zero raw/processed weight", () => {
    const result = evaluateYieldGuardrail({
      animalType: "lamb",
      cutId: "rack",
      cutName: "Rack / best end",
      cutWeightKg: 1,
      processedWeightKg: 0,
    });

    expect(result.status).toBe("invalid_weight");
    expect(result.severity).toBe("warning");
  });

  it("warns on negative cut weight", () => {
    const result = evaluateYieldGuardrail({
      animalType: "lamb",
      cutId: "rack",
      cutName: "Rack / best end",
      cutWeightKg: -1,
      processedWeightKg: 20,
    });

    expect(result.status).toBe("invalid_weight");
    expect(result.explanation).toContain("invalid");
  });
});

describe("mass integrity", () => {
  it("accounts for shrinkage, saleable cuts and waste", () => {
    const result = calculateMassIntegrity({
      rawWeightKg: 20,
      moistureLossKg: 1,
      cuts: [
        { id: "leg", name: "Leg", weightKg: 10 },
        { id: "rack", name: "Rack", weightKg: 7 },
        { id: "waste", name: "Waste", weightKg: 2, isWaste: true },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.explanation).toContain("accounted for");
  });

  it("reports unallocated mass without silently balancing", () => {
    const result = calculateMassIntegrity({
      rawWeightKg: 20,
      moistureLossKg: 1,
      cuts: [
        { id: "leg", name: "Leg", weightKg: 10 },
        { id: "waste", name: "Waste", weightKg: 2, isWaste: true },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.unallocatedKg).toBe(7);
    expect(result.explanation).toContain("7kg is currently unallocated");
  });
});

describe("cut map and tool fallbacks", () => {
  it("finds configured cut-map regions", () => {
    expect(findCutMapRegion("lamb", "rack")?.label).toBe("Rack");
    expect(findCutMapRegion("beef", "topside")?.label).toBe("Topside/silverside");
  });

  it("exposes cut-map lookup fallback", () => {
    expect(hasCutMapFallback("lamb", "unknown cut")).toBe(true);
  });

  it("finds configured tool guidance", () => {
    expect(getToolGuidance("rack")?.tools).toContain("boning knife");
  });

  it("exposes tool-badge fallback", () => {
    expect(hasToolFallback("unknown cut")).toBe(true);
  });
});

describe("retail tips", () => {
  it("generates practical tips with explicit reasons", () => {
    const tips = generateRetailTips({
      animalType: "lamb",
      cuts: [
        { id: "mince-trim", name: "Mince & trim", weightKg: 2, band: "healthy", marginPct: 0.3 },
        { id: "rack", name: "Rack / best end", weightKg: 1.4, tier: "premium", band: "low", marginPct: 0.2 },
      ],
    });

    expect(tips.some((tip) => tip.message.includes("kofta"))).toBe(true);
    expect(tips.every((tip) => tip.reason.length > 0)).toBe(true);
  });
});
