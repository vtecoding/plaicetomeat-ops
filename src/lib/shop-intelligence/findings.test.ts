import { describe, expect, it } from "vitest";

import {
  buildCoachNudges,
  buildConsistencyChecks,
  buildYieldReality,
  findingsFromOwnerActions,
  rankFindings,
} from "./findings";
import { makeAction, makeBatch, makeSnapshot } from "./test-helpers";
import type { Finding } from "./types";

describe("findingsFromOwnerActions", () => {
  it("upgrades an OwnerAction to the explain-everything Finding contract", () => {
    const [finding] = findingsFromOwnerActions([makeAction()]);
    expect(finding.area).toBe("stock");
    expect(finding.finding).toBe("Beef mince is running low");
    // estimatedImpact becomes the explicit consequence (V8.4).
    expect(finding.consequence).toContain("unable to order");
    expect(finding.recommendedAction).toContain("Order more");
    expect(finding.playbook?.slug).toBe("handling-low-stock");
    expect(finding.source).toBe("owner-action");
    expect(finding.metrics.length).toBeGreaterThan(0);
  });

  it("maps every category to an area", () => {
    const categories = ["stock", "waste", "margin", "compliance", "customer", "basket", "system"] as const;
    for (const category of categories) {
      const [finding] = findingsFromOwnerActions([makeAction({ category })]);
      expect(finding.area).toBeTruthy();
    }
  });
});

describe("buildYieldReality (V8.2 / V8.11)", () => {
  it("flags a cut that consistently yields under its estimate", () => {
    const batches = [
      makeBatch({ expectedWeightKg: 18, actualWeightKg: 15, varianceKg: -3 }),
      makeBatch({ expectedWeightKg: 18, actualWeightKg: 15.5, varianceKg: -2.5 }),
      makeBatch({ expectedWeightKg: 18, actualWeightKg: 14.5, varianceKg: -3.5 }),
    ];
    const [finding] = buildYieldReality(batches);
    expect(finding.area).toBe("yield");
    expect(finding.finding).toContain("less than expected");
    expect(finding.severity).toBe("warning"); // ~17% under → warning
    expect(finding.confidence).toBe("medium"); // 3 intakes
    expect(finding.recommendedAction).toContain("Review trimming");
  });

  it("flags a cut that consistently over-delivers as an info opportunity", () => {
    const batches = Array.from({ length: 6 }, () =>
      makeBatch({ productName: "Goat shoulder", expectedWeightKg: 10, actualWeightKg: 11.5, varianceKg: 1.5 }),
    );
    const [finding] = buildYieldReality(batches);
    expect(finding.finding).toContain("more than expected");
    expect(finding.severity).toBe("info");
    expect(finding.confidence).toBe("high"); // 6 intakes
  });

  it("says nothing without enough confirmed intakes", () => {
    expect(buildYieldReality([makeBatch({ expectedWeightKg: 18, actualWeightKg: 15, varianceKg: -3 })])).toEqual([]);
  });

  it("ignores unconfirmed intakes (no actual recorded)", () => {
    const batches = [
      makeBatch({ actualConfirmedAt: null, expectedWeightKg: 18, actualWeightKg: 15, varianceKg: -3 }),
      makeBatch({ actualConfirmedAt: null, expectedWeightKg: 18, actualWeightKg: 15, varianceKg: -3 }),
    ];
    expect(buildYieldReality(batches)).toEqual([]);
  });

  it("stays quiet when actual closely matches expected", () => {
    const batches = [
      makeBatch({ expectedWeightKg: 18, actualWeightKg: 18, varianceKg: 0 }),
      makeBatch({ expectedWeightKg: 18, actualWeightKg: 17.9, varianceKg: -0.1 }),
    ];
    expect(buildYieldReality(batches)).toEqual([]);
  });
});

describe("buildConsistencyChecks (V8.12)", () => {
  it("flags stock marked gone that still shows weight", () => {
    const snapshot = makeSnapshot({
      batches: [makeBatch({ status: "depleted", remainingWeightKg: 5 })],
    });
    const finding = buildConsistencyChecks(snapshot).find((f) => f.id === "consistency-ghost-stock");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("urgently flags out-of-date stock still marked sellable", () => {
    const snapshot = makeSnapshot({
      batches: [makeBatch({ status: "active", remainingWeightKg: 3, daysToExpiry: -2 })],
    });
    const finding = buildConsistencyChecks(snapshot).find((f) => f.id === "consistency-expired-active");
    expect(finding?.severity).toBe("urgent");
    expect(finding?.consequence).toContain("food-safety");
  });

  it("flags products selling with no cost", () => {
    const snapshot = makeSnapshot({
      products: { total: 20, zeroPrice: 0, missingCost: 3, missingStockInfo: 0, activeSellingNoCost: 3 },
    });
    const finding = buildConsistencyChecks(snapshot).find((f) => f.id === "consistency-selling-no-cost");
    expect(finding).toBeDefined();
  });

  it("finds nothing when subsystems agree", () => {
    expect(buildConsistencyChecks(makeSnapshot())).toEqual([]);
  });
});

describe("buildCoachNudges (V8.5)", () => {
  it("nudges a stock count after a long idle gap", () => {
    const snapshot = makeSnapshot({
      stock: { batchesExpiringWithin3Days: 0, valueAtRisk: 0, activeBatchCount: 8, daysSinceLastStockActivity: 20 },
    });
    const nudge = buildCoachNudges(snapshot).find((f) => f.id === "coach-stock-accuracy");
    expect(nudge?.area).toBe("discipline");
    expect(nudge?.severity).toBe("info");
    expect(nudge?.explanation).toContain("20 days");
  });

  it("nudges waste logging only when there is stock but no waste recorded", () => {
    const withStock = makeSnapshot({
      waste: { weekValue: 0, monthValue: 0, byProduct: [], byReason: [], eventsThisWeek: 0 },
    });
    expect(buildCoachNudges(withStock).some((f) => f.id === "coach-waste-logging")).toBe(true);

    const noStock = makeSnapshot({
      stock: { batchesExpiringWithin3Days: 0, valueAtRisk: 0, activeBatchCount: 0, daysSinceLastStockActivity: null },
      waste: { weekValue: 0, monthValue: 0, byProduct: [], byReason: [], eventsThisWeek: 0 },
    });
    expect(buildCoachNudges(noStock).some((f) => f.id === "coach-waste-logging")).toBe(false);
  });

  it("nudges cost coverage when products lack a cost", () => {
    const snapshot = makeSnapshot({
      products: { total: 20, zeroPrice: 0, missingCost: 5, missingStockInfo: 0, activeSellingNoCost: 0 },
    });
    expect(buildCoachNudges(snapshot).some((f) => f.id === "coach-cost-coverage")).toBe(true);
  });

  it("stays quiet for a well-run, well-recorded shop", () => {
    expect(buildCoachNudges(makeSnapshot())).toEqual([]);
  });
});

describe("rankFindings", () => {
  it("orders by severity, then confidence, then headline", () => {
    const base: Omit<Finding, "id" | "severity" | "confidence" | "finding"> = {
      area: "stock",
      explanation: "",
      consequence: "",
      recommendedAction: "",
      basis: { confidence: "low", summary: "", points: [] },
      playbook: null,
      metrics: [],
      source: "engine",
    };
    const ranked = rankFindings([
      { ...base, id: "a", severity: "info", confidence: "high", finding: "Info" },
      { ...base, id: "b", severity: "urgent", confidence: "low", finding: "Urgent low" },
      { ...base, id: "c", severity: "urgent", confidence: "high", finding: "Urgent high" },
    ]);
    expect(ranked.map((f) => f.id)).toEqual(["c", "b", "a"]);
  });
});
