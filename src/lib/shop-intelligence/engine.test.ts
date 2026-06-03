import { describe, expect, it } from "vitest";

import { buildShopIntelligence as engineEntry } from "@/lib/domain/operational-intelligence-v2";
import { buildFindings, buildShopIntelligence } from "./engine";
import { makeAction, makeBatch, makeSnapshot } from "./test-helpers";

describe("buildShopIntelligence (V8 engine)", () => {
  it("returns the whole V8 picture from one snapshot", () => {
    const intel = buildShopIntelligence(makeSnapshot());
    expect(intel.briefing).toBeDefined();
    expect(intel.health.categories).toHaveLength(6);
    expect(intel.weekly.topProduct).toBe("Chicken breast");
    expect(intel.confidence.confidence).toBeDefined();
    expect(intel.findings.length).toBeGreaterThan(0);
  });

  it("merges owner actions, yield reality, consistency and coaching into one ranked list", () => {
    const snapshot = makeSnapshot({
      ownerActions: [makeAction({ severity: "urgent", id: "cert-expired", category: "compliance", title: "Certificate expired" })],
      batches: [
        makeBatch({ expectedWeightKg: 18, actualWeightKg: 14, varianceKg: -4 }),
        makeBatch({ expectedWeightKg: 18, actualWeightKg: 14.5, varianceKg: -3.5 }),
        makeBatch({ expectedWeightKg: 18, actualWeightKg: 13.8, varianceKg: -4.2 }),
        // a contradiction: gone but weight remains
        makeBatch({ productName: "Beef short rib", status: "disposed", remainingWeightKg: 6, actualConfirmedAt: null }),
      ],
      products: { total: 20, zeroPrice: 0, missingCost: 3, missingStockInfo: 0, activeSellingNoCost: 0 },
    });
    const findings = buildFindings(snapshot);
    const areas = new Set(findings.map((f) => f.area));
    expect(areas.has("compliance")).toBe(true); // owner action
    expect(areas.has("yield")).toBe(true); // reality learning
    expect(areas.has("consistency")).toBe(true); // ghost stock
    expect(areas.has("discipline")).toBe(true); // cost coaching

    // The urgent compliance item must rank first.
    expect(findings[0].severity).toBe("urgent");
  });

  it("every finding answers why / consequence / what-to-do (V8.4)", () => {
    for (const finding of buildFindings(makeSnapshot({ products: { total: 20, zeroPrice: 0, missingCost: 2, missingStockInfo: 0, activeSellingNoCost: 0 } }))) {
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(finding.consequence.length).toBeGreaterThan(0);
      expect(finding.recommendedAction.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(finding.confidence);
    }
  });

  it("does not mutate the snapshot it is given (Golden Rule, V8.13)", () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);
    buildShopIntelligence(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("is reachable through the spec-named entry point", () => {
    expect(typeof engineEntry).toBe("function");
    expect(engineEntry(makeSnapshot()).briefing).toBeDefined();
  });
});
