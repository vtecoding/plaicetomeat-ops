import { describe, expect, it } from "vitest";

import { classifyDoctrine, compareActions, compressActions, DO_NOW_MAX } from "./action-compression";
import type { MoneyImpact, OwnerDecision } from "./types";

/** Minimal valid decision; override only what a scenario cares about. */
function mk(over: Partial<OwnerDecision> & { id: string }): OwnerDecision {
  return {
    category: "important",
    area: "stock",
    priority: 100,
    title: `Action ${over.id}`,
    whatHappened: "",
    whyItMatters: "",
    recommendedAction: "Do something.",
    estimatedImpact: { kind: "none", label: "Hard to put a figure on yet" },
    owner: "You / Owner",
    dueWindow: "this_week",
    sourceEvidence: { basis: { confidence: "high", summary: "", points: [] }, metrics: [] },
    playbook: null,
    ...over,
  };
}

const money = (kind: MoneyImpact["kind"], oneOff?: number): MoneyImpact => ({
  kind,
  ...(oneOff !== undefined ? { oneOff } : {}),
  label: "money",
});

// Canonical decisions by doctrine tier, for the head-to-head ranking proofs.
const compliance = mk({ id: "compliance-fridge", area: "compliance", recommendedAction: "Sort the food safety check." });
const sellFirst = mk({ id: "operator-sell-first-beef-1", area: "expiry", recommendedAction: "Sell this first." });
const orderMore = mk({ id: "operator-order-chicken", area: "stock", recommendedAction: "Order Chicken tomorrow." });
const countToday = mk({ id: "operator-count-lamb", area: "stock", recommendedAction: "Count Lamb today." });
const opportunity = mk({ id: "yield-over-ribeye", area: "yield", category: "opportunity", recommendedAction: "Charge a little more.", estimatedImpact: money("opportunity", 1000) });

describe("V15 action compression — doctrine classification", () => {
  it("maps each action onto the doctrine hierarchy", () => {
    expect(classifyDoctrine(compliance)).toBe("prevent_loss");
    expect(classifyDoctrine(mk({ id: "x", area: "expiry", recommendedAction: "Check Beef now and record waste if needed." }))).toBe("prevent_loss");
    expect(classifyDoctrine(sellFirst)).toBe("prevent_waste");
    expect(classifyDoctrine(orderMore)).toBe("prevent_stockout");
    expect(classifyDoctrine(countToday)).toBe("reduce_work");
    expect(classifyDoctrine(opportunity)).toBe("improve_profit");
    expect(classifyDoctrine(mk({ id: "operator-order-less-mince", recommendedAction: "Order less Mince next time." }))).toBe("improve_profit");
  });
});

describe("V15 action compression — the contest", () => {
  it("compresses more than three candidates down to exactly three (1)", () => {
    const result = compressActions([compliance, sellFirst, orderMore, countToday, opportunity, mk({ id: "extra-1" }), mk({ id: "extra-2" })]);
    expect(result.doNow).toHaveLength(DO_NOW_MAX);
    expect(DO_NOW_MAX).toBe(3);
  });

  it("keeps fewer than three as fewer — never pads or invents (2)", () => {
    const result = compressActions([compliance, countToday]);
    expect(result.doNow).toHaveLength(2);
    expect(result.later).toHaveLength(0);
  });

  it("preserves every non-winning action in the Later reserve (3)", () => {
    const all = [compliance, sellFirst, orderMore, countToday, opportunity];
    const result = compressActions(all);
    const seen = [...result.doNow, ...result.later].map((d) => d.id).sort();
    expect(seen).toEqual(all.map((d) => d.id).sort());
    expect(result.later.length).toBe(all.length - DO_NOW_MAX);
  });

  it("lets doctrine priority beat money-only noise (4)", () => {
    // A loss-prevention action with no priceable figure must still beat a big-money opportunity.
    const richOpportunity = mk({ id: "yield-over-fat", area: "yield", category: "opportunity", recommendedAction: "Charge more.", estimatedImpact: money("opportunity", 5000) });
    const result = compressActions([richOpportunity, compliance]);
    expect(result.doNow[0]?.id).toBe(compliance.id);
  });

  it("ranks loss-prevention above time-saving (5)", () => {
    const result = compressActions([countToday, compliance]);
    expect(result.doNow[0]?.id).toBe(compliance.id);
  });

  it("ranks waste-prevention above profit-only (6)", () => {
    const result = compressActions([opportunity, sellFirst]);
    expect(result.doNow[0]?.id).toBe(sellFirst.id);
  });

  it("ranks stock-out prevention above convenience (7)", () => {
    const result = compressActions([countToday, orderMore]);
    expect(result.doNow[0]?.id).toBe(orderMore.id);
  });

  it("orders deterministically regardless of input order (8)", () => {
    const all = [compliance, sellFirst, orderMore, countToday, opportunity];
    const forward = compressActions(all).doNow.map((d) => d.id);
    const reversed = compressActions([...all].reverse()).doNow.map((d) => d.id);
    expect(forward).toEqual(reversed);
    // Pure tie (same doctrine, money, urgency) breaks on stable id, ascending.
    const a = mk({ id: "aaa", area: "stock", recommendedAction: "Count A today." });
    const b = mk({ id: "bbb", area: "stock", recommendedAction: "Count B today." });
    expect(compareActions(a, b)).toBeLessThan(0);
    expect(compressActions([b, a]).doNow.map((d) => d.id)).toEqual(["aaa", "bbb"]);
  });

  it("never upgrades a low-confidence Count into a Sell or Order (9)", () => {
    const count = mk({ id: "operator-count-chicken-breast", area: "stock", title: "Please count Chicken Breast today", recommendedAction: "Count Chicken Breast today." });
    const result = compressActions([count, orderMore, sellFirst]);
    const surfaced = [...result.doNow, ...result.later].find((d) => d.id === count.id);
    // Same object reference — compression re-orders, it does not rewrite.
    expect(surfaced).toBe(count);
    expect(surfaced?.recommendedAction).toBe("Count Chicken Breast today.");
    expect(surfaced?.recommendedAction.toLowerCase()).not.toMatch(/^\s*(sell|order)\b/);
    expect(classifyDoctrine(count)).toBe("reduce_work");
  });

  it("never leaks a score, rank, confidence or doctrine word into operator output (10)", () => {
    const result = compressActions([compliance, sellFirst, orderMore, countToday, opportunity]);
    // Only the strings the butcher actually reads on screen.
    const operatorText = [...result.doNow, ...result.later]
      .flatMap((d) => [d.title, d.whatHappened, d.whyItMatters, d.recommendedAction, d.estimatedImpact.label])
      .join(" ");
    expect(operatorText.toLowerCase()).not.toMatch(/score|confidence|priorit|ranked|ranking|weight|doctrine|prevent_loss|prevent_waste/);
  });

  it("excludes bad candidates instead of breaking the contest (failure mode)", () => {
    const broken = { ...mk({ id: "broken" }), recommendedAction: "  " };
    const result = compressActions([compliance, broken]);
    expect(result.doNow.map((d) => d.id)).toEqual([compliance.id]);
    expect(result.excluded).toContainEqual({ id: "broken", reason: "missing required action fields" });
  });

  it("records internal evidence for audit without exposing it to the operator (engine guarantee)", () => {
    const result = compressActions([compliance, sellFirst, orderMore, countToday]);
    expect(result.evidence).toHaveLength(4);
    expect(result.evidence[0]).toMatchObject({ id: compliance.id, doctrine: "prevent_loss", doctrineRank: 6, rank: 1, won: true });
    expect(result.evidence.filter((e) => e.won)).toHaveLength(DO_NOW_MAX);
  });
});
