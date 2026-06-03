import { describe, expect, it } from "vitest";
import { findForbiddenTerms } from "./language";
import { categorise, rankDecisions, toOwnerDecision } from "./decisions";
import { makeFinding } from "./test-helpers";

describe("toOwnerDecision", () => {
  it("maps a finding onto the V9 schema and strips jargon", () => {
    const decision = toOwnerDecision(
      makeFinding({ finding: "Lamb leg yield variance", explanation: "operational health dipped" }),
    );
    expect(decision.title).toContain("less sellable meat than expected");
    expect(decision.whatHappened).toContain("how the shop is doing");
    expect(findForbiddenTerms(`${decision.title} ${decision.whatHappened}`)).toEqual([]);
    expect(decision.owner).toBe("You / Owner");
    expect(decision.dueWindow).toBe("today");
    expect(decision.sourceEvidence.basis.confidence).toBe("high");
  });

  it("routes order/counter work to the counter team", () => {
    const decision = toOwnerDecision(makeFinding({ area: "orders", severity: "warning" }));
    expect(decision.owner).toBe("Counter team");
    expect(decision.dueWindow).toBe("this_week");
  });
});

describe("categorise", () => {
  it("urgent severity → urgent bucket", () => {
    expect(categorise(makeFinding({ severity: "urgent" }))).toBe("urgent");
  });
  it("warning severity → important bucket", () => {
    expect(categorise(makeFinding({ severity: "warning" }))).toBe("important");
  });
  it("good-news info → opportunity bucket", () => {
    expect(categorise(makeFinding({ id: "yield-over-lamb", area: "yield", severity: "info" }))).toBe("opportunity");
  });
  it("housekeeping info → important (never mixed with opportunities)", () => {
    expect(categorise(makeFinding({ id: "coach-cost-coverage", area: "discipline", severity: "info" }))).toBe("important");
  });
});

describe("rankDecisions", () => {
  it("orders by priority then money at stake", () => {
    const big = toOwnerDecision(makeFinding({ id: "a", area: "waste", severity: "warning", metrics: [{ label: "w", value: "£200" }] }));
    const small = toOwnerDecision(makeFinding({ id: "b", area: "waste", severity: "warning", metrics: [{ label: "w", value: "£5" }] }));
    const ranked = rankDecisions([small, big]);
    expect(ranked[0].id).toBe("a");
  });
});
