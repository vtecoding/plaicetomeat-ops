/**
 * Operator-facing wording for what happened to stock when an order is collected.
 *
 * The engine underneath is sophisticated (batch ledger, FEFO depletion, signed
 * movements, shortfall flags). The butcher must see none of that. Per the
 * Operator-First Doctrine he only ever reads plain outcomes:
 *   - weight-tracked stock updated itself
 *   - non-weight items are counted by hand
 *   - if a count looks off, count it again when convenient
 *
 * There is intentionally no "movement", "ledger", "delta", "depletion",
 * "shortfall" or "negative stock" language anywhere a normal operator can see.
 */

export type CollectionShortfallItem = { productName: string; shortKg: number };

export type CollectionStockSummary = {
  status: "completed" | "completed_with_shortfall";
  /** Lines on kg products whose stock was moved automatically. */
  weightTrackedLines: number;
  /** Lines on each/box products — sellable, but counted by hand for now. */
  nonWeightTrackedLines: number;
  /** Products where less stock was on record than the order took (allow + flag). */
  shortfall: CollectionShortfallItem[];
};

/** "A", "A and B", "A, B and C" — natural English list joining. */
export function joinNames(names: string[]): string {
  const clean = names.filter((name) => name.trim().length > 0);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/**
 * Build the one-line confirmation the operator sees after tapping Collected.
 * Calm and plain — "customer served, I'll check stock later" — never an error.
 */
export function buildCollectionStockMessage(summary: CollectionStockSummary | null | undefined): string {
  if (!summary) return "Collected.";

  if (summary.shortfall.length > 0) {
    const names = joinNames(summary.shortfall.map((item) => item.productName));
    return `Collected. Please count ${names} when convenient.`;
  }

  if (summary.weightTrackedLines > 0) {
    return "Collected — stock updated.";
  }

  return "Collected. Stock for these items is counted manually.";
}
