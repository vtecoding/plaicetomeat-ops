import { describe, expect, it } from "vitest";

import { resolveOpeningFloatDefault } from "./float-default";

describe("resolveOpeningFloatDefault", () => {
  it("prefers a real last closing float base when one is available", () => {
    expect(
      resolveOpeningFloatDefault({ lastCloseFloatGbp: 50, lastOpenFloatGbp: 40, branchDefaultFloatGbp: 30 }),
    ).toEqual({ valueGbp: 50, source: "last_close", confidence: "high" });
  });

  it("falls back to yesterday's opening float (the live predictor in PTM)", () => {
    expect(
      resolveOpeningFloatDefault({ lastCloseFloatGbp: null, lastOpenFloatGbp: 40, branchDefaultFloatGbp: 30 }),
    ).toEqual({ valueGbp: 40, source: "last_open", confidence: "high" });
  });

  it("falls back to a configured branch default when there is no session history", () => {
    expect(
      resolveOpeningFloatDefault({ lastCloseFloatGbp: null, lastOpenFloatGbp: null, branchDefaultFloatGbp: 30 }),
    ).toEqual({ valueGbp: 30, source: "branch_default", confidence: "medium" });
  });

  it("returns no default when nothing is known — the operator is asked normally", () => {
    expect(
      resolveOpeningFloatDefault({ lastCloseFloatGbp: null, lastOpenFloatGbp: null, branchDefaultFloatGbp: null }),
    ).toEqual({ valueGbp: null, source: null, confidence: "none" });
  });

  it("treats a negative or non-finite value as not usable", () => {
    expect(resolveOpeningFloatDefault({ lastCloseFloatGbp: -5, lastOpenFloatGbp: 40, branchDefaultFloatGbp: null }).source).toBe("last_open");
    expect(resolveOpeningFloatDefault({ lastCloseFloatGbp: Number.NaN, lastOpenFloatGbp: null, branchDefaultFloatGbp: null }).source).toBeNull();
  });
});
