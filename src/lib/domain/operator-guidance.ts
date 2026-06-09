import type { IntelConfidence, IntelSeverity } from "@/lib/shop-intelligence/types";

export type InventoryOperatorSignal = "trusted" | "count_soon" | "count_today";
export type ProductHealthSignal = "Healthy" | "Check Soon" | "Needs Attention";

export type InventoryTruthGuidanceInput = {
  productId: string;
  productName: string;
  operatorSignal: InventoryOperatorSignal;
  internalReasons?: string[];
};

export type PurchasingGuidanceInput = {
  kind: "order_more" | "order_less";
  productName: string;
  confidence?: IntelConfidence;
};

export type ExpiryGuidanceInput = {
  productName: string;
  daysToExpiry: number;
  valueAtRisk: number;
};

export type ProductHealthInput = {
  productId: string;
  productName: string;
  inventorySignal?: InventoryOperatorSignal;
  daysToExpiry?: number | null;
  daysUntilRunout?: number | null;
  shortfallCount30d?: number;
  lastCountDaysAgo?: number | null;
  salesCount?: number;
};

export type OperatorGuidanceCard = {
  id: string;
  productName: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  recommendedAction: string;
  severity: IntelSeverity;
  confidence: IntelConfidence;
  priority: number;
  health: ProductHealthSignal;
  source: "inventory_truth" | "purchasing" | "expiry";
  valueAtRisk: number | null;
};

export function buildOperatorGuidanceCards(input: {
  inventoryTruth?: InventoryTruthGuidanceInput[];
  purchasing?: PurchasingGuidanceInput[];
  expiry?: ExpiryGuidanceInput[];
  maxCards?: number;
}): OperatorGuidanceCard[] {
  const cards = [
    ...(input.inventoryTruth ?? []).flatMap(cardFromInventoryTruth),
    ...(input.expiry ?? []).flatMap(cardFromExpiry),
    ...(input.purchasing ?? []).flatMap(cardFromPurchasing),
  ];

  return dedupeGuidance(cards)
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
    .slice(0, input.maxCards ?? 6);
}

export function buildProductHealthSignals(products: ProductHealthInput[]): Array<{ productId: string; productName: string; status: ProductHealthSignal }> {
  return products.map((product) => ({
    productId: product.productId,
    productName: product.productName,
    status: productHealth(product),
  }));
}

function cardFromInventoryTruth(row: InventoryTruthGuidanceInput): OperatorGuidanceCard[] {
  if (row.operatorSignal === "trusted") return [];

  const repeatedProblem = (row.internalReasons ?? []).some((reason) => reason === "repeated_shortfall" || reason === "cache_mismatch");
  const countToday = row.operatorSignal === "count_today";
  const productName = row.productName;

  return [
    {
      id: `operator-count-${slug(productName)}`,
      productName,
      title: countToday ? `Please count ${productName} today` : `Please count ${productName} soon`,
      whatHappened: repeatedProblem ? "Stock keeps changing unexpectedly." : "This stock needs a fresh count.",
      whyItMatters: "Ordering and serving are easier when this item is checked.",
      recommendedAction: countToday ? `Count ${productName} today.` : `Count ${productName} when you can.`,
      severity: countToday ? "urgent" : "warning",
      confidence: countToday ? "high" : "medium",
      priority: countToday ? 95 : 65,
      health: countToday ? "Needs Attention" : "Check Soon",
      source: "inventory_truth",
      valueAtRisk: null,
    },
  ];
}

function cardFromPurchasing(row: PurchasingGuidanceInput): OperatorGuidanceCard[] {
  const productName = row.productName;
  if (row.kind === "order_more") {
    return [
      {
        id: `operator-order-${slug(productName)}`,
        productName,
        title: `Order ${productName} tomorrow`,
        whatHappened: `${productName} is running low.`,
        whyItMatters: "You may run short before the next supplier run.",
        recommendedAction: `Order ${productName} tomorrow.`,
        severity: "warning",
        confidence: row.confidence ?? "medium",
        priority: 75,
        health: "Check Soon",
        source: "purchasing",
        valueAtRisk: null,
      },
    ];
  }

  return [
    {
      id: `operator-order-less-${slug(productName)}`,
      productName,
      title: `Order less ${productName} next time`,
      whatHappened: `${productName} is not moving cleanly enough.`,
      whyItMatters: "Buying a bit less helps keep the counter fresher.",
      recommendedAction: `Order less ${productName} next time.`,
      severity: "warning",
      confidence: row.confidence ?? "medium",
      priority: 70,
      health: "Check Soon",
      source: "purchasing",
      valueAtRisk: null,
    },
  ];
}

function cardFromExpiry(row: ExpiryGuidanceInput): OperatorGuidanceCard[] {
  if (row.daysToExpiry > 2) return [];
  const productName = row.productName;
  const expired = row.daysToExpiry < 0;

  return [
    {
      id: `operator-sell-first-${slug(productName)}-${row.daysToExpiry}`,
      productName,
      title: expired ? `Check ${productName} now` : `Sell ${productName} first`,
      whatHappened: expired ? "This stock may no longer be sellable." : `${productName} is short-dated.`,
      whyItMatters: expired ? "It should not sit with sellable stock." : "Selling it first protects good stock and avoids waste.",
      recommendedAction: expired ? `Check ${productName} now and record waste if needed.` : "Sell this first.",
      severity: expired || row.daysToExpiry === 0 ? "urgent" : "warning",
      confidence: "high",
      priority: expired ? 100 : row.daysToExpiry === 0 ? 90 : 68,
      health: expired || row.daysToExpiry === 0 ? "Needs Attention" : "Check Soon",
      source: "expiry",
      valueAtRisk: row.valueAtRisk > 0 ? row.valueAtRisk : null,
    },
  ];
}

function productHealth(product: ProductHealthInput): ProductHealthSignal {
  if (
    product.inventorySignal === "count_today" ||
    (product.shortfallCount30d ?? 0) >= 2 ||
    (product.daysToExpiry ?? 99) <= 0 ||
    (product.daysUntilRunout ?? 99) <= 1
  ) {
    return "Needs Attention";
  }

  if (
    product.inventorySignal === "count_soon" ||
    (product.lastCountDaysAgo ?? 0) > 7 ||
    (product.daysToExpiry ?? 99) <= 2 ||
    (product.daysUntilRunout ?? 99) <= 3
  ) {
    return "Check Soon";
  }

  return "Healthy";
}

function dedupeGuidance(cards: OperatorGuidanceCard[]): OperatorGuidanceCard[] {
  const byProduct = new Map<string, OperatorGuidanceCard>();
  for (const card of cards) {
    const key = card.productName.toLowerCase();
    const existing = byProduct.get(key);
    if (!existing || card.priority > existing.priority) {
      byProduct.set(key, card);
    }
  }
  return [...byProduct.values()];
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
