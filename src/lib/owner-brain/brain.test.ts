import { describe, expect, it } from "vitest";
import { makeBatch, makeAction } from "@/lib/shop-intelligence/test-helpers";
import { buildOwnerBrain, findDecision, getDecisionDiagnostics } from "./brain";
import { findForbiddenTerms } from "./language";
import { makeFinding, makeIntel } from "./test-helpers";

const CONFIRMED = "2026-06-01T10:00:00.000Z";

describe("buildOwnerBrain", () => {
  it("hides every decision in setup mode and shows only getting-started", () => {
    const intel = makeIntel({ products: { total: 0, zeroPrice: 0, missingCost: 0, missingStockInfo: 0, activeSellingNoCost: 0 } });
    const brain = buildOwnerBrain(intel);
    expect(brain.setupMode).toBe(true);
    expect(brain.gettingStarted.show).toBe(true);
    expect(brain.doNow).toEqual([]);
    expect(brain.later).toEqual([]);
    expect(brain.walkSteps).toEqual([]);
    // The internal diagnostics path is empty too.
    const diag = getDecisionDiagnostics(intel);
    expect(diag.urgent).toEqual([]);
    expect(diag.important).toEqual([]);
    expect(diag.opportunities).toEqual([]);
  });

  it("sorts problems into the three internal buckets once the shop is set up", () => {
    const intel = makeIntel({
      batches: [
        makeBatch({ productName: "Old beef", status: "active", remainingWeightKg: 5, daysToExpiry: -2, expectedWeightKg: 0, actualWeightKg: 0, varianceKg: 0, actualConfirmedAt: null }),
        makeBatch({ productName: "Lamb leg", expectedWeightKg: 18, actualWeightKg: 20, varianceKg: 2, actualConfirmedAt: CONFIRMED }),
        makeBatch({ productName: "Lamb leg", expectedWeightKg: 18, actualWeightKg: 20, varianceKg: 2, actualConfirmedAt: CONFIRMED }),
      ],
      ownerActions: [
        makeAction(),
        makeAction({ id: "basket-bundle", category: "basket", severity: "info", title: "Mince buyers often add chicken thighs" }),
      ],
    });
    const brain = buildOwnerBrain(intel);
    expect(brain.setupMode).toBe(false);
    // Bucketing is an internal-engine concern, proven via the diagnostics path.
    const diag = getDecisionDiagnostics(intel);
    expect(diag.urgent.some((d) => d.id === "consistency-expired-active")).toBe(true);
    expect(diag.important.length).toBeGreaterThan(0);
    expect(diag.opportunities.length).toBeGreaterThan(0);
    // Opportunities are never problems.
    expect(diag.opportunities.every((d) => d.category === "opportunity")).toBe(true);
  });

  it("caps urgent at 5 and important at 10 (internal buckets)", () => {
    const base = makeIntel();
    const intel = {
      ...base,
      findings: [
        ...Array.from({ length: 8 }, (_, i) => makeFinding({ id: `urgent-${i}`, severity: "urgent" as const })),
        ...Array.from({ length: 14 }, (_, i) => makeFinding({ id: `warn-${i}`, severity: "warning" as const, area: "stock" as const })),
      ],
    };
    const diag = getDecisionDiagnostics(intel);
    expect(diag.urgent.length).toBe(5);
    expect(diag.important.length).toBe(10);
  });

  it("V15 — compresses TODAY to at most three Do-now actions, with the rest in Later", () => {
    const base = makeIntel();
    const intel = {
      ...base,
      findings: [
        ...Array.from({ length: 8 }, (_, i) => makeFinding({ id: `urgent-${i}`, severity: "urgent" as const })),
        ...Array.from({ length: 14 }, (_, i) => makeFinding({ id: `warn-${i}`, severity: "warning" as const, area: "stock" as const })),
      ],
    };
    const brain = buildOwnerBrain(intel);
    // No path may surface a fourth primary action.
    expect(brain.doNow.length).toBeLessThanOrEqual(3);
    // Nothing is lost — every candidate is either Do-now or Later.
    expect(brain.doNow.length + brain.later.length).toBe(22);
    // Setup-mode shops are shown nothing here.
    const empty = buildOwnerBrain(makeIntel({ products: { total: 0, zeroPrice: 0, missingCost: 0, missingStockInfo: 0, activeSellingNoCost: 0 } }));
    expect(empty.doNow).toEqual([]);
    expect(empty.later).toEqual([]);
  });

  it("never leaks forbidden jargon onto the owner brain", () => {
    const intel = makeIntel({
      batches: [
        makeBatch({ productName: "Lamb leg", expectedWeightKg: 18, actualWeightKg: 15, varianceKg: -3, actualConfirmedAt: CONFIRMED }),
        makeBatch({ productName: "Lamb leg", expectedWeightKg: 18, actualWeightKg: 15, varianceKg: -3, actualConfirmedAt: CONFIRMED }),
      ],
    });
    const brain = buildOwnerBrain(intel);
    expect(findForbiddenTerms(JSON.stringify(brain))).toEqual([]);
  });

  it("does not mutate its input", () => {
    const intel = makeIntel();
    const snapshot = JSON.stringify(intel);
    buildOwnerBrain(intel);
    expect(JSON.stringify(intel)).toBe(snapshot);
  });

  it("findDecision locates an operator action across the operator surfaces", () => {
    const intel = makeIntel();
    const brain = buildOwnerBrain(intel);
    const first = [...brain.doNow, ...brain.later, ...brain.walkSteps][0];
    if (first) {
      expect(findDecision(brain, first.id)?.id).toBe(first.id);
    }
    expect(findDecision(brain, "no-such-id")).toBeNull();
  });

  it("builds a weekly summary with at most three of each", () => {
    const brain = buildOwnerBrain(makeIntel());
    expect(brain.weekly.wins.length).toBeLessThanOrEqual(3);
    expect(brain.weekly.risks.length).toBeLessThanOrEqual(3);
    expect(brain.weekly.opportunities.length).toBeLessThanOrEqual(3);
  });
});
