import { describe, expect, it } from "vitest";

import { isLowConfidence, verbAllowedForSignal, type GuidanceVerb } from "./confidence-routing";

const ALL_VERBS: GuidanceVerb[] = ["sell", "order", "count", "fix"];

describe("confidence → verb contract", () => {
  it("trusted confidence allows every verb", () => {
    for (const verb of ALL_VERBS) {
      expect(verbAllowedForSignal(verb, "trusted")).toBe(true);
    }
  });

  it("an unflagged product (no signal) is treated as trusted", () => {
    for (const verb of ALL_VERBS) {
      expect(verbAllowedForSignal(verb, undefined)).toBe(true);
      expect(verbAllowedForSignal(verb, null)).toBe(true);
    }
  });

  it("low confidence routes to count ONLY — never sell/order/fix", () => {
    for (const signal of ["count_soon", "count_today"] as const) {
      expect(verbAllowedForSignal("count", signal)).toBe(true);
      expect(verbAllowedForSignal("order", signal)).toBe(false);
      expect(verbAllowedForSignal("sell", signal)).toBe(false);
      expect(verbAllowedForSignal("fix", signal)).toBe(false);
    }
  });

  it("there is no bypass: the only verb low confidence ever permits is count", () => {
    const lowSignals = ["count_soon", "count_today"] as const;
    for (const signal of lowSignals) {
      const allowed = ALL_VERBS.filter((verb) => verbAllowedForSignal(verb, signal));
      expect(allowed).toEqual(["count"]);
    }
  });

  it("classifies low vs high confidence", () => {
    expect(isLowConfidence("trusted")).toBe(false);
    expect(isLowConfidence(undefined)).toBe(false);
    expect(isLowConfidence("count_soon")).toBe(true);
    expect(isLowConfidence("count_today")).toBe(true);
  });
});
