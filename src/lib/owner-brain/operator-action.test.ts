import { describe, expect, it } from "vitest";

import { getDecisionDiagnostics } from "./brain";
import { toOperatorAction, toOperatorActions } from "./operator-action";
import { makeIntel } from "./test-helpers";
import type { MoneyImpact, OperatorAction, OwnerDecision } from "./types";

/**
 * Field-name substrings that must never appear on an external operator action. If any key
 * contains one of these, an internal calculation has leaked across the firewall.
 */
const FORBIDDEN_FIELD_TERMS = [
  "score",
  "confidence",
  "priority",
  "severity",
  "rank",
  "ranking",
  "weight",
  "internal",
  "reasoncode",
  "signal",
  "raw",
  "velocity",
  "forecast",
  "variance",
  "ledger",
  "movement",
  "delta",
] as const;

function scored(over: Partial<OwnerDecision> & { id: string }): OwnerDecision {
  return {
    category: "urgent",
    area: "stock",
    priority: 275,
    title: `Action ${over.id}`,
    whatHappened: "Stock keeps changing unexpectedly.",
    whyItMatters: "Ordering and serving are easier when this item is checked.",
    recommendedAction: "Count Chicken Breast today.",
    estimatedImpact: { kind: "loss", oneOff: 40, label: "About £40 at risk" } as MoneyImpact,
    owner: "You / Owner",
    dueWindow: "today",
    sourceEvidence: { basis: { confidence: "high", summary: "Based on confirmed shop records", points: [] }, metrics: [{ label: "Batches", value: "3" }] },
    playbook: { slug: "stock-count", title: "How to count stock" },
    ...over,
  };
}

/** Recursively collect every object key in a value (so nested shapes are checked too). */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, acc);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      acc.push(key);
      allKeys(child, acc);
    }
  }
  return acc;
}

describe("V15.4 intelligence firewall — OperatorAction shape (spec tests 1, 3)", () => {
  it("carries no forbidden internal field name, anywhere in the shape", () => {
    const op = toOperatorAction(scored({ id: "operator-count-chicken-breast" }));
    for (const key of allKeys(op)) {
      const lower = key.toLowerCase();
      for (const term of FORBIDDEN_FIELD_TERMS) {
        expect(lower.includes(term), `OperatorAction key "${key}" contains forbidden term "${term}"`).toBe(false);
      }
    }
  });

  it("strips the scored fields that the internal action carried", () => {
    const internal = scored({ id: "operator-count-chicken-breast" });
    const op = toOperatorAction(internal) as Record<string, unknown>;
    // The scored input genuinely had these; the operator action must not.
    expect(internal.priority).toBeTypeOf("number");
    expect(internal.sourceEvidence.basis.confidence).toBe("high");
    expect("priority" in op).toBe(false);
    expect("category" in op).toBe(false);
    expect("sourceEvidence" in op).toBe(false);
    expect("estimatedImpact" in op).toBe(false);
    // No confidence value survives anywhere (only the plain summary text does).
    expect(JSON.stringify(op).toLowerCase()).not.toContain("confidence");
  });

  it("keeps the safe display fields the operator surfaces need", () => {
    const op = toOperatorAction(scored({ id: "operator-count-chicken-breast" }));
    expect(op.id).toBe("operator-count-chicken-breast");
    expect(op.actionType).toBe("count");
    expect(op.destination).toBe("/admin/stock-count");
    expect(op.entityLabel).toBe("Chicken Breast");
    expect(op.href).toContain("focus=chicken-breast");
    expect(op.impactLabel).toBe("About £40 at risk");
    expect(op.dueLabel).toBe("Today");
    expect(op.basisSummary).toBe("Based on confirmed shop records");
    expect(op.completion).toBe("available");
  });
});

describe("V15.4 intelligence firewall — ScoredAction keeps evidence (spec test 2)", () => {
  it("the internal diagnostics path still carries scores and ranking evidence", () => {
    const diag = getDecisionDiagnostics(makeIntel());
    const sample = [...diag.doNow, ...diag.later][0];
    if (sample) {
      expect(sample.priority).toBeTypeOf("number");
      expect(sample.sourceEvidence.basis.confidence).toBeDefined();
    }
    // Evidence is preserved for explainability (each ranked action has a record).
    expect(Array.isArray(diag.evidence)).toBe(true);
    for (const ev of diag.evidence) {
      expect(ev).toHaveProperty("doctrineRank");
      expect(ev).toHaveProperty("rank");
    }
  });
});

describe("V15.4 intelligence firewall — type-level guard", () => {
  it("OperatorAction cannot name a forbidden field (compile-time)", () => {
    // These assignments only compile because OperatorAction has no such keys. If a future
    // edit adds `confidence`/`priority`/etc., `@ts-expect-error` becomes unused and fails.
    // @ts-expect-error — OperatorAction has no `confidence`
    const a: keyof OperatorAction = "confidence";
    // @ts-expect-error — OperatorAction has no `priority`
    const b: keyof OperatorAction = "priority";
    // @ts-expect-error — OperatorAction has no `score`
    const c: keyof OperatorAction = "score";
    void a;
    void b;
    void c;
  });

  it("toOperatorActions converts a list in order", () => {
    const list = toOperatorActions([scored({ id: "operator-count-a" }), scored({ id: "operator-order-b", recommendedAction: "Order B tomorrow." })]);
    expect(list.map((a) => a.id)).toEqual(["operator-count-a", "operator-order-b"]);
    expect(list[1].actionType).toBe("order");
  });
});
