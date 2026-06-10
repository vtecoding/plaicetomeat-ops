import { describe, expect, it } from "vitest";

import { classifyActionType, resolveActionTarget } from "./action-target";
import type { MoneyImpact, OwnerDecision } from "./types";

/** Minimal valid decision; override only what a scenario cares about. */
function mk(over: Partial<OwnerDecision> & { id: string }): OwnerDecision {
  return {
    category: "important",
    area: "stock",
    priority: 100,
    title: `Action ${over.id}`,
    whatHappened: "Something happened.",
    whyItMatters: "It matters.",
    recommendedAction: "Do something.",
    estimatedImpact: { kind: "none", label: "Hard to put a figure on yet" } as MoneyImpact,
    owner: "You / Owner",
    dueWindow: "this_week",
    sourceEvidence: { basis: { confidence: "high", summary: "", points: [] }, metrics: [] },
    playbook: null,
    ...over,
  };
}

// Canonical decisions, mirroring the ids/wording that operator-guidance actually emits.
const count = mk({
  id: "operator-count-chicken-breast",
  area: "stock",
  title: "Please count Chicken Breast today",
  recommendedAction: "Count Chicken Breast today.",
});
const order = mk({ id: "operator-order-chicken", area: "stock", recommendedAction: "Order Chicken tomorrow." });
const orderLess = mk({ id: "operator-order-less-mince", area: "stock", recommendedAction: "Order less Mince next time." });
const sell = mk({ id: "operator-sell-first-lamb-leg-1", area: "expiry", recommendedAction: "Sell this first." });
const sellNegativeDays = mk({ id: "operator-sell-first-beef--1", area: "expiry", recommendedAction: "Sell this first." });
const expiredFix = mk({
  id: "operator-sell-first-pork-belly--2",
  area: "expiry",
  recommendedAction: "Check Pork Belly now and record waste if needed.",
});
const compliance = mk({ id: "action-cert-expired", area: "compliance", recommendedAction: "Sort the food safety check." });
const review = mk({ id: "yield-over-ribeye", area: "yield", category: "opportunity", recommendedAction: "Charge a little more." });

describe("V15.2 action target — classification (spec tests 1–4, 7)", () => {
  it("maps each operator action onto its verb", () => {
    expect(classifyActionType(count)).toBe("count");
    expect(classifyActionType(order)).toBe("order");
    expect(classifyActionType(orderLess)).toBe("order");
    expect(classifyActionType(sell)).toBe("sell");
    expect(classifyActionType(expiredFix)).toBe("fix");
    expect(classifyActionType(compliance)).toBe("fix");
    expect(classifyActionType(review)).toBe("review");
  });
});

describe("V15.2 action target — destinations", () => {
  it("1. count opens the stock-count target, item pre-focused", () => {
    const target = resolveActionTarget(count);
    expect(target.actionType).toBe("count");
    expect(target.destination).toBe("/admin/stock-count");
    expect(target.entitySlug).toBe("chicken-breast");
    expect(target.entityLabel).toBe("Chicken Breast");
    expect(target.href).toContain("/admin/stock-count?");
    expect(target.href).toContain("focus=chicken-breast");
    expect(target.href).toContain("from=today");
    expect(target.href).toContain("do=count");
  });

  it("2. order opens the purchasing target for the right product", () => {
    const target = resolveActionTarget(order);
    expect(target.destination).toBe("/admin/purchasing");
    expect(target.entitySlug).toBe("chicken");
    expect(target.href).toContain("focus=chicken");
    // Order lands on a server-rendered card, so the link carries a scroll anchor.
    expect(target.href.endsWith("#chicken")).toBe(true);
  });

  it("3. sell opens the product context (inventory) for the right item", () => {
    const target = resolveActionTarget(sell);
    expect(target.destination).toBe("/admin/inventory");
    expect(target.entitySlug).toBe("lamb-leg");
    expect(target.href).toContain("focus=lamb-leg");
  });

  it("strips a negative day-count from the sell-first id", () => {
    expect(resolveActionTarget(sellNegativeDays).entitySlug).toBe("beef");
  });

  it("4. fix opens the compliance target (no per-item slug — keyed by supplier)", () => {
    const target = resolveActionTarget(compliance);
    expect(target.destination).toBe("/admin/compliance");
    expect(target.entitySlug).toBeNull();
    expect(target.href).toContain("/admin/compliance?");
    expect(target.href).toContain("from=today");
  });

  it("expired check-and-record-waste routes to the single correction door", () => {
    const target = resolveActionTarget(expiredFix);
    expect(target.actionType).toBe("fix");
    expect(target.destination).toBe("/admin/stock-count");
  });

  it("non-operator findings fall back to the read-only detail page (no work screen)", () => {
    const target = resolveActionTarget(review);
    expect(target.actionType).toBe("review");
    expect(target.destination).toBe("/admin/today/yield-over-ribeye");
    expect(target.href).toBe("/admin/today/yield-over-ribeye");
    // No focus context is appended to a review fallback.
    expect(target.href).not.toContain("?");
  });
});

describe("V15.2 action target — safety", () => {
  it("7. a count never resolves to a sell or order destination", () => {
    const target = resolveActionTarget(count);
    expect(target.destination).not.toBe("/admin/inventory");
    expect(target.destination).not.toBe("/admin/purchasing");
  });

  it("8. every destination is a read/work route, never a mutation endpoint (no auto-execution)", () => {
    const WORK_ROUTES = ["/admin/stock-count", "/admin/purchasing", "/admin/inventory", "/admin/compliance"];
    for (const decision of [count, order, orderLess, sell, expiredFix, compliance]) {
      const { destination, href } = resolveActionTarget(decision);
      expect(WORK_ROUTES).toContain(destination);
      // A GET navigation into a page — never an /api/ or server-action style path.
      expect(href.startsWith("/admin/")).toBe(true);
      expect(href).not.toMatch(/\/api\//);
    }
  });

  it("carries the reason so the destination knows why the operator arrived (survives refresh via URL)", () => {
    const target = resolveActionTarget(count);
    expect(target.reason).toBe("Something happened.");
    // Parsed the way Next.js reads searchParams — the why context rides along in the URL.
    const parsed = new URLSearchParams(target.href.split("?")[1]);
    expect(parsed.get("why")).toBe("Something happened.");
  });
});
