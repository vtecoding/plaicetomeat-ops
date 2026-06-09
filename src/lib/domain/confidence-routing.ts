/**
 * Confidence → Verb contract  (V14.3 · Workstream A)
 * ---------------------------------------------------
 * The operator NEVER sees confidence (doctrine). Internally, a product's
 * inventory-truth confidence decides *which verb* the operator may be given:
 *
 *     trusted      (high confidence) → sell / order / fix / count   all allowed
 *     count_soon   (low confidence)  → count ONLY
 *     count_today  (low confidence)  → count ONLY
 *
 * Why this exists
 * ---------------
 * We must never instruct a butcher to SELL or ORDER based on stock we do not
 * trust. A product with repeated shortfalls, a cache mismatch or a stale count
 * is low-confidence; the only safe instruction is "count this". Low-confidence
 * truth therefore degrades gracefully into a count, never into a confident
 * wrong instruction ("Order Chicken tomorrow" off a number we don't believe).
 *
 * This is the enforced seam between the V14 truth engine (which produces the
 * signal) and operator guidance / any future V15 action ranking (which consume
 * it). It is a pure function with no side effects so it can be unit-tested and
 * protected against regression in isolation.
 *
 * Forbidden (these must be impossible):
 *     confidence weak → Order Chicken tomorrow
 *     confidence weak → Sell Lamb Leg first
 * Good:
 *     confidence weak   → Count Chicken Breast today
 *     confidence strong → Order Chicken tomorrow
 */

/** Inventory-truth confidence signal (mirrors truth-hardening `ConfidenceSignal`). */
export type ConfidenceSignal = "trusted" | "count_soon" | "count_today";

/** The operator-facing verbs guidance can produce. */
export type GuidanceVerb = "sell" | "order" | "count" | "fix";

/** Low confidence = anything other than a fully trusted signal. */
export function isLowConfidence(signal: ConfidenceSignal | undefined | null): boolean {
  return signal === "count_soon" || signal === "count_today";
}

/**
 * The contract. Returns whether `verb` may be shown to the operator for a
 * product carrying `signal`. Absent/undefined signal is treated as trusted
 * (a product the truth engine did not flag is, by definition, trusted).
 */
export function verbAllowedForSignal(verb: GuidanceVerb, signal: ConfidenceSignal | undefined | null): boolean {
  if (!isLowConfidence(signal)) return true; // trusted (or unflagged) → all verbs allowed
  return verb === "count"; // low confidence → count only
}
