/**
 * Margin erosion (pure) — the silent leak.
 *
 * When a supplier's cost rises but the shelf price doesn't follow, the owner quietly earns
 * less on every kilo and nothing says so. This detects that case from cost history and
 * proposes a price that restores the margin the owner originally priced at. It NEVER
 * changes a price — it surfaces a recommendation the owner reviews.
 *
 * Firewall note: the relative drop is a percentage and is kept in metrics only (never a
 * display string), like repeatRate — the owner card speaks money and a suggested price.
 */
export type ProductMargin = {
  productName: string;
  pricePerKg: number;
  currentCostPerKg: number;
  priorCostPerKg: number;
};

export type ErosionFinding = {
  productName: string;
  pricePerKg: number;
  currentCostPerKg: number;
  priorCostPerKg: number;
  /** Fractions 0..1. */
  currentMargin: number;
  priorMargin: number;
  /** Relative drop in margin, integer percent — metrics only, never displayed. */
  marginDropPct: number;
  /** £ of profit lost per kg now vs before (= the cost increase). */
  perKgProfitDrop: number;
  /** A price that restores the prior margin against the new cost. */
  suggestedPricePerKg: number;
};

// Don't nag on noise: needs a real relative drop AND a non-trivial per-kg amount.
const MIN_MARGIN_DROP_PCT = 8;
const MIN_PER_KG_DROP = 0.2;
const MAX_EROSION_FINDINGS = 3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function analyseMarginErosion(item: ProductMargin): ErosionFinding | null {
  const price = item.pricePerKg;
  const current = item.currentCostPerKg;
  const prior = item.priorCostPerKg;

  if (!(price > 0) || !(current > 0) || !(prior > 0)) return null;
  if (current <= prior) return null; // cost didn't rise — not erosion
  if (current >= price) return null; // already underwater — a worse, separate finding

  const currentMargin = (price - current) / price;
  const priorMargin = (price - prior) / price;
  if (priorMargin <= 0) return null;

  const marginDropPct = Math.round(((priorMargin - currentMargin) / priorMargin) * 100);
  const perKgProfitDrop = round2(current - prior);
  if (marginDropPct < MIN_MARGIN_DROP_PCT || perKgProfitDrop < MIN_PER_KG_DROP) return null;

  // Restore the prior margin against the new cost: price = cost / (1 - margin).
  const suggestedPricePerKg = round2(current / (1 - priorMargin));

  return {
    productName: item.productName,
    pricePerKg: price,
    currentCostPerKg: current,
    priorCostPerKg: prior,
    currentMargin,
    priorMargin,
    marginDropPct,
    perKgProfitDrop,
    suggestedPricePerKg,
  };
}

/** Worst money-per-kg erosion first; capped so it never floods Do Now. */
export function detectMarginErosion(items: ProductMargin[]): ErosionFinding[] {
  return items
    .map(analyseMarginErosion)
    .filter((finding): finding is ErosionFinding => finding !== null)
    .sort((a, b) => b.perKgProfitDrop - a.perKgProfitDrop || b.marginDropPct - a.marginDropPct || a.productName.localeCompare(b.productName))
    .slice(0, MAX_EROSION_FINDINGS);
}

/**
 * Derive each product's current vs prior cost from batch cost history. "Current" is the
 * most recent batch cost; "prior" is the most recent earlier cost that actually differs,
 * so a run of identical-cost deliveries doesn't read as a change.
 */
export function buildProductMargins(
  products: Array<{ id: string; name: string; pricePerKg: number }>,
  batchCosts: Array<{ productId: string; costPerKg: number; receivedDate: string }>,
): ProductMargin[] {
  const byProduct = new Map<string, Array<{ costPerKg: number; receivedDate: string }>>();
  for (const batch of batchCosts) {
    if (!(batch.costPerKg > 0)) continue;
    const list = byProduct.get(batch.productId) ?? [];
    list.push({ costPerKg: batch.costPerKg, receivedDate: batch.receivedDate });
    byProduct.set(batch.productId, list);
  }

  const out: ProductMargin[] = [];
  for (const product of products) {
    if (!(product.pricePerKg > 0)) continue;
    const history = (byProduct.get(product.id) ?? []).sort((a, b) =>
      a.receivedDate < b.receivedDate ? 1 : a.receivedDate > b.receivedDate ? -1 : 0,
    );
    if (history.length < 2) continue;
    const current = history[0]!.costPerKg;
    const prior = history.find((entry) => entry.costPerKg !== current)?.costPerKg;
    if (prior == null) continue;
    out.push({ productName: product.name, pricePerKg: product.pricePerKg, currentCostPerKg: current, priorCostPerKg: prior });
  }
  return out;
}
