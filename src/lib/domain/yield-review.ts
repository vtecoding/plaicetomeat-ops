/**
 * Yield review status (V7.0 Part 10).
 *
 * The carcass calculator's prices come from standard cut-sheet yield estimates,
 * not from cutting the shop's own animals. Until a real butcher signs the yields
 * off, the UI must present them as an estimated guide — never as proven
 * "recommended" prices. This module holds the honest wording and a status type
 * so a future migration can persist a real review lifecycle without UI churn.
 */

export type YieldReviewStatus = "unverified" | "needs_review" | "reviewed" | "approved";

export const YIELD_REVIEW_STATUS_LABEL: Record<YieldReviewStatus, string> = {
  unverified: "Unverified",
  needs_review: "Needs butcher review",
  reviewed: "Reviewed",
  approved: "Approved",
};

/** No persistence yet — yields are unverified until a butcher checks them. */
export const DEFAULT_YIELD_REVIEW_STATUS: YieldReviewStatus = "unverified";

export const YIELD_REVIEW_DISCLAIMER =
  "Estimated guide — needs butcher review. These prices use standard yield estimates, not your own cutting results yet. Use them as a starting point and check them against what you actually get.";

/** Prices are only "recommended" once a butcher has approved the yields. */
export function isYieldApproved(status: YieldReviewStatus): boolean {
  return status === "approved";
}

export function yieldPricesHeading(status: YieldReviewStatus): string {
  return isYieldApproved(status) ? "Recommended prices" : "Suggested prices (estimated guide)";
}

export function yieldPriceMetricLabel(status: YieldReviewStatus): string {
  return isYieldApproved(status) ? "Recommended price" : "Suggested price";
}
