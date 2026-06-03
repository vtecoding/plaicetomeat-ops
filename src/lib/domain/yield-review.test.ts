import { describe, expect, it } from "vitest";

import {
  DEFAULT_YIELD_REVIEW_STATUS,
  isYieldApproved,
  YIELD_REVIEW_DISCLAIMER,
  YIELD_REVIEW_STATUS_LABEL,
  yieldPriceMetricLabel,
  yieldPricesHeading,
} from "./yield-review";

describe("yield review status", () => {
  it("defaults to unverified until a butcher checks the yields", () => {
    expect(DEFAULT_YIELD_REVIEW_STATUS).toBe("unverified");
    expect(isYieldApproved(DEFAULT_YIELD_REVIEW_STATUS)).toBe(false);
  });

  it("has plain-English labels for every status", () => {
    expect(YIELD_REVIEW_STATUS_LABEL).toMatchObject({
      unverified: "Unverified",
      needs_review: "Needs butcher review",
      reviewed: "Reviewed",
      approved: "Approved",
    });
  });

  it("tells the owner the numbers need butcher review", () => {
    expect(YIELD_REVIEW_DISCLAIMER.toLowerCase()).toContain("needs butcher review");
  });

  it("never calls unverified prices 'recommended'", () => {
    expect(yieldPricesHeading("unverified")).toBe("Suggested prices (estimated guide)");
    expect(yieldPriceMetricLabel("unverified")).toBe("Suggested price");
  });

  it("only uses 'recommended' wording once approved", () => {
    expect(yieldPricesHeading("approved")).toBe("Recommended prices");
    expect(yieldPriceMetricLabel("approved")).toBe("Recommended price");
  });
});
