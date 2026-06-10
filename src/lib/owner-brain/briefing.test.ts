import { describe, expect, it } from "vitest";

import { BRIEFING_WORD_LIMIT, buildMorningBriefing } from "./briefing";
import { toOperatorAction } from "./operator-action";
import type { MorningSignal, MoneyImpact, OperatorAction, OwnerDecision } from "./types";

/**
 * Build an operator action through the real firewall conversion — exactly what the briefing
 * receives in production. Override only what a scenario cares about on the scored input.
 */
function op(over: Partial<OwnerDecision> & { id: string }): OperatorAction {
  const scored: OwnerDecision = {
    category: "important",
    area: "stock",
    priority: 100,
    title: `Action ${over.id}`,
    whatHappened: "",
    whyItMatters: "",
    recommendedAction: "Do something.",
    estimatedImpact: { kind: "none", label: "Hard to put a figure on yet" } as MoneyImpact,
    owner: "You / Owner",
    dueWindow: "this_week",
    sourceEvidence: { basis: { confidence: "high", summary: "", points: [] }, metrics: [] },
    playbook: null,
    ...over,
  };
  return toOperatorAction(scored);
}

const compliance = op({ id: "action-cert-expired", area: "compliance", recommendedAction: "Sort the food safety check." });
const sell = op({ id: "operator-sell-first-lamb-leg-1", area: "expiry", recommendedAction: "Sell this first." });
const order = op({ id: "operator-order-chicken", area: "stock", recommendedAction: "Order Chicken tomorrow." });
const count = op({ id: "operator-count-beef-mince", area: "stock", recommendedAction: "Count Beef Mince today." });

const tradedClean: MorningSignal = { expiringBatches: 0, certificatesExpiring: 0, wasteYesterday: 0, revenueYesterday: 800 };
const tradedWaste: MorningSignal = { expiringBatches: 0, certificatesExpiring: 0, wasteYesterday: 12, revenueYesterday: 800 };
const quietDay: MorningSignal = { expiringBatches: 0, certificatesExpiring: 0, wasteYesterday: 0, revenueYesterday: 0 };

const allText = (b: { yesterday: string; today: string; ignore: string }) => `${b.yesterday} ${b.today} ${b.ignore}`;

describe("V15.3 morning briefing — generation (spec test 1)", () => {
  it("produces all three sections from real signals", () => {
    const b = buildMorningBriefing({ doNow: [compliance, order], later: [count], morning: tradedClean });
    expect(b.yesterday.length).toBeGreaterThan(0);
    expect(b.today.length).toBeGreaterThan(0);
    expect(b.ignore.length).toBeGreaterThan(0);
  });

  it("reflects the shape of yesterday", () => {
    expect(buildMorningBriefing({ doNow: [], later: [], morning: tradedClean }).yesterday).toMatch(/steady/i);
    expect(buildMorningBriefing({ doNow: [], later: [], morning: tradedWaste }).yesterday).toMatch(/wast/i);
    expect(buildMorningBriefing({ doNow: [], later: [], morning: quietDay }).yesterday).toMatch(/quiet/i);
  });
});

describe("V15.3 morning briefing — information firewall (spec tests 2, 3, 4)", () => {
  const scenarios = [
    buildMorningBriefing({ doNow: [compliance, order, sell], later: [count], morning: tradedWaste }),
    buildMorningBriefing({ doNow: [], later: [], morning: quietDay }),
    buildMorningBriefing({ doNow: [count], later: [], morning: tradedClean }),
  ];

  it("never exposes a KPI, number or percentage", () => {
    for (const b of scenarios) expect(allText(b)).not.toMatch(/\d|%/);
  });

  it("never exposes confidence, ranking, score or doctrine language", () => {
    for (const b of scenarios) {
      expect(allText(b).toLowerCase()).not.toMatch(/confidence|score|rank|priorit|weight|doctrine|prevent_/);
    }
  });
});

describe("V15.3 morning briefing — size (spec tests 5, 6, 8)", () => {
  it("stays within the word limit even on a busy day", () => {
    const busy = buildMorningBriefing({
      doNow: [compliance, sell, order],
      later: [count, op({ id: "operator-count-pork" }), op({ id: "operator-order-duck" })],
      morning: tradedWaste,
    });
    expect(busy.wordCount).toBeLessThanOrEqual(BRIEFING_WORD_LIMIT);
    expect(BRIEFING_WORD_LIMIT).toBe(100);
  });

  it("reports an accurate word count", () => {
    const b = buildMorningBriefing({ doNow: [order], later: [], morning: tradedClean });
    const counted = allText(b).trim().split(/\s+/).filter(Boolean).length;
    expect(b.wordCount).toBe(counted);
  });

  it("is shorter than the actions it precedes (briefing orients, actions decide)", () => {
    const doNow = [compliance, sell, order];
    const b = buildMorningBriefing({ doNow, later: [count], morning: tradedClean });
    const actionWords = doNow
      .flatMap((d) => [d.title, d.recommendedAction, d.impactLabel])
      .join(" ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    expect(b.wordCount).toBeLessThan(actionWords);
  });
});

describe("V15.3 morning briefing — never contradicts Do Now (spec test 7)", () => {
  it("does not claim food safety is fine when a certificate action is live", () => {
    const b = buildMorningBriefing({ doNow: [compliance], later: [], morning: tradedClean });
    expect(b.ignore.toLowerCase()).not.toContain("food safety");
    // ...and the Today shape names the certificate instead.
    expect(b.today.toLowerCase()).toContain("certificate");
  });

  it("does not claim stock is safe when a sell-first action is live", () => {
    const b = buildMorningBriefing({ doNow: [sell], later: [], morning: tradedClean });
    expect(b.ignore.toLowerCase()).not.toContain("about to expire");
  });

  it("does not say the day is clear when actions exist", () => {
    const b = buildMorningBriefing({ doNow: [order], later: [], morning: tradedClean });
    expect(b.today.toLowerCase()).not.toContain("looks clear");
  });

  it("says the day is clear only when there are no actions", () => {
    const b = buildMorningBriefing({ doNow: [], later: [], morning: tradedClean });
    expect(b.today.toLowerCase()).toContain("clear");
  });
});

describe("V15.3 morning briefing — failure modes", () => {
  it("always produces an Ignore line, even when everything is a problem", () => {
    const b = buildMorningBriefing({
      doNow: [compliance, sell, order],
      later: [],
      morning: { expiringBatches: 4, certificatesExpiring: 2, wasteYesterday: 30, revenueYesterday: 600 },
    });
    expect(b.ignore.trim().length).toBeGreaterThan(0);
  });

  it("still briefs a clear, quiet day", () => {
    const b = buildMorningBriefing({ doNow: [], later: [], morning: quietDay });
    expect(b.yesterday).toMatch(/quiet/i);
    expect(b.today).toMatch(/clear/i);
    expect(b.ignore.trim().length).toBeGreaterThan(0);
  });
});
