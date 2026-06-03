import { describe, expect, it } from "vitest";
import { estimateMoneyImpact, isUpsideFinding, moneyMagnitude } from "./money";
import { makeFinding } from "./test-helpers";

describe("estimateMoneyImpact", () => {
  it("reads a real £ figure as a one-off risk", () => {
    const impact = estimateMoneyImpact(
      makeFinding({ area: "expiry", metrics: [{ label: "Value at risk", value: "£85" }] }),
    );
    expect(impact.kind).toBe("risk");
    expect(impact.oneOff).toBe(85);
    expect(impact.label).toContain("£85");
  });

  it("treats waste money as a weekly loss", () => {
    const impact = estimateMoneyImpact(
      makeFinding({ area: "waste", metrics: [{ label: "Waste this week", value: "£40" }] }),
    );
    expect(impact.kind).toBe("loss");
    expect(impact.weeklyHigh).toBe(40);
    expect(impact.label).toContain("a week");
  });

  it("describes weight at stake when it cannot be priced", () => {
    const impact = estimateMoneyImpact(
      makeFinding({ area: "consistency", metrics: [{ label: "Weight", value: "12kg" }] }),
    );
    expect(impact.kind).toBe("risk");
    expect(impact.label).toContain("12kg");
  });

  it("never fabricates a figure — falls back honestly", () => {
    const impact = estimateMoneyImpact(
      makeFinding({ area: "stock", metrics: [{ label: "Days of cover", value: "2" }], explanation: "low", consequence: "x", finding: "y" }),
    );
    expect(impact.weeklyLow).toBeUndefined();
    expect(impact.oneOff).toBeUndefined();
  });

  it("reads good-news findings as opportunities", () => {
    const finding = makeFinding({ id: "yield-over-lamb-leg", area: "yield", severity: "info" });
    expect(isUpsideFinding(finding)).toBe(true);
    expect(estimateMoneyImpact(finding).kind).toBe("opportunity");
  });

  it("ranks priced losses above qualitative ones above no-figure", () => {
    const priced = estimateMoneyImpact(makeFinding({ area: "waste", metrics: [{ label: "w", value: "£40" }] }));
    const qualitative = estimateMoneyImpact(makeFinding({ area: "compliance", metrics: [], explanation: "x", consequence: "y", finding: "z" }));
    const none = estimateMoneyImpact(makeFinding({ area: "discipline", metrics: [], explanation: "x", consequence: "y", finding: "z" }));
    expect(moneyMagnitude(priced)).toBeGreaterThan(moneyMagnitude(qualitative));
    expect(moneyMagnitude(qualitative)).toBeGreaterThan(moneyMagnitude(none));
  });
});
