import { describe, expect, it } from "vitest";

import { buildBasis, capConfidence, minConfidence, summariseConfidence } from "./confidence";

describe("capConfidence", () => {
  it("never lets confidence exceed the cap", () => {
    expect(capConfidence("high", "low")).toBe("low");
    expect(capConfidence("high", "medium")).toBe("medium");
    expect(capConfidence("low", "high")).toBe("low");
  });
});

describe("minConfidence", () => {
  it("returns the weaker level", () => {
    expect(minConfidence("high", "medium")).toBe("medium");
    expect(minConfidence("low", "high")).toBe("low");
    expect(minConfidence("medium", "medium")).toBe("medium");
  });
});

describe("buildBasis", () => {
  it("is high only when every evidence point clears its high threshold", () => {
    const basis = buildBasis([{ label: "confirmed intakes", count: 8, highAt: 6, mediumAt: 3 }]);
    expect(basis.confidence).toBe("high");
    expect(basis.summary).toContain("8 confirmed intakes");
    expect(basis.points).toEqual(["8 confirmed intakes"]);
  });

  it("is dragged down to the weakest point", () => {
    const basis = buildBasis([
      { label: "weeks of sales", count: 8, highAt: 6, mediumAt: 3 },
      { label: "purchases", count: 1, highAt: 6, mediumAt: 3 },
    ]);
    expect(basis.confidence).toBe("low");
  });

  it("returns an honest low basis when there is no evidence", () => {
    const basis = buildBasis([], "no waste recorded this week");
    expect(basis.confidence).toBe("low");
    expect(basis.summary).toContain("no waste recorded this week");
    expect(basis.points).toEqual([]);
  });
});

describe("summariseConfidence", () => {
  it("rolls up to the weakest contributing basis", () => {
    const summary = summariseConfidence([
      { confidence: "high", summary: "", points: ["8 weeks of sales"] },
      { confidence: "medium", summary: "", points: ["3 intakes"] },
    ]);
    expect(summary.confidence).toBe("medium");
    expect(summary.points).toContain("8 weeks of sales");
  });

  it("is honest when there is nothing to go on", () => {
    expect(summariseConfidence([]).confidence).toBe("low");
  });
});
