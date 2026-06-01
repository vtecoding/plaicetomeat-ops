/**
 * Purchasing intelligence — owner *guidance* for buying decisions.
 *
 * Core principle: every recommendation must answer "why are you telling me this?"
 * Each recommendation carries its reason, the supporting metrics, a confidence
 * level and a generated date. If the evidence isn't there, no recommendation is
 * produced. Nothing here places orders or guesses missing costs.
 *
 * This is pure synthesis over signals the platform already computes (sales
 * velocity from the depletion forecast, per-product waste, product performance),
 * so it adds no new data sources and no external calls.
 */
export type PurchasingConfidence = "low" | "medium" | "high";

const CONFIDENCE_ORDER: Record<PurchasingConfidence, number> = { low: 0, medium: 1, high: 2 };

/** Clamp a base confidence so it can never exceed what the data quality supports. */
export function capConfidence(base: PurchasingConfidence, cap: PurchasingConfidence): PurchasingConfidence {
  return CONFIDENCE_ORDER[base] <= CONFIDENCE_ORDER[cap] ? base : cap;
}

export type PurchasingRecommendation = {
  id: string;
  kind: "order_more" | "order_less";
  productName: string;
  title: string;
  reason: string;
  metrics: Array<{ label: string; value: string }>;
  suggestedAction: string;
  confidence: PurchasingConfidence;
  generatedDate: string;
  /** Feature 9 ranking: lower = shown first. Waste risk (3) outranks stock risk (4). */
  priorityRank: number;
};

export type DepletionRowInput = {
  productName: string;
  state: string;
  remainingWeightKg: number;
  daysUntilRunout: number | null;
  dailyVelocityKg: number | null;
};

export type ProductWasteInput = {
  productName: string;
  weeklyWasteValue: number;
  weeklyWasteKg: number;
};

export type PurchasingThresholds = {
  /** Recommend ordering more when cover is at or below this many days. */
  coverageThresholdDays: number;
  /** Recommend ordering less when weekly waste value is at or above this (GBP). */
  wasteValueThreshold: number;
  /** ...or when weekly waste weight is at or above this (kg). */
  wasteKgThreshold: number;
};

export const DEFAULT_PURCHASING_THRESHOLDS: PurchasingThresholds = {
  coverageThresholdDays: 3,
  wasteValueThreshold: 5,
  wasteKgThreshold: 1,
};

function roundTo(value: number, dp: number) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function gbp(value: number) {
  return `£${value.toFixed(2)}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatGeneratedDate(now: Date) {
  return dateFormatter.format(now);
}

/**
 * Build explainable buy-more / buy-less recommendations.
 * - Order more: a product is selling steadily and stock cover is short.
 * - Order less: a product is generating meaningful waste week on week.
 * Confidence never exceeds the supplied `confidenceCap` (from data quality).
 */
export function buildPurchasingRecommendations(input: {
  depletion: DepletionRowInput[];
  productWaste: ProductWasteInput[];
  now: Date;
  confidenceCap?: PurchasingConfidence;
  thresholds?: PurchasingThresholds;
}): PurchasingRecommendation[] {
  const cap = input.confidenceCap ?? "high";
  const thresholds = input.thresholds ?? DEFAULT_PURCHASING_THRESHOLDS;
  const generatedDate = formatGeneratedDate(input.now);
  const recommendations: PurchasingRecommendation[] = [];

  // Order LESS — waste risk (priority 3, shown before stock risk).
  for (const waste of input.productWaste) {
    if (waste.weeklyWasteValue < thresholds.wasteValueThreshold && waste.weeklyWasteKg < thresholds.wasteKgThreshold) {
      continue;
    }
    recommendations.push({
      id: `order-less-${slug(waste.productName)}`,
      kind: "order_less",
      productName: waste.productName,
      title: `Order less ${waste.productName}`,
      reason: `${gbp(waste.weeklyWasteValue)} of ${waste.productName} (${roundTo(waste.weeklyWasteKg, 2)}kg) was recorded as waste this week. Buying less reduces that loss directly.`,
      metrics: [
        { label: "Waste this week", value: gbp(waste.weeklyWasteValue) },
        { label: "Wasted weight", value: `${roundTo(waste.weeklyWasteKg, 2)}kg` },
      ],
      suggestedAction:
        "Consider reducing your next order of this product by 10–20%, and sell short-dated stock first via a bundle or counter offer.",
      confidence: capConfidence("medium", cap),
      generatedDate,
      priorityRank: 3,
    });
  }

  // Order MORE — stock risk (priority 4).
  for (const row of input.depletion) {
    if (row.state !== "enough_data" || row.daysUntilRunout === null || (row.dailyVelocityKg ?? 0) <= 0) {
      continue;
    }
    if (row.daysUntilRunout > thresholds.coverageThresholdDays) {
      continue;
    }
    const weeklySalesKg = roundTo((row.dailyVelocityKg ?? 0) * 7, 1);
    const baseConfidence: PurchasingConfidence = row.daysUntilRunout <= 2 ? "high" : "medium";
    recommendations.push({
      id: `order-more-${slug(row.productName)}`,
      kind: "order_more",
      productName: row.productName,
      title: `Order more ${row.productName}`,
      reason: `${row.productName} is selling about ${weeklySalesKg}kg a week with only ${roundTo(row.remainingWeightKg, 1)}kg in stock — roughly ${row.daysUntilRunout} day${row.daysUntilRunout === 1 ? "" : "s"} of cover left.`,
      metrics: [
        { label: "Avg weekly sales", value: `${weeklySalesKg}kg` },
        { label: "Current stock", value: `${roundTo(row.remainingWeightKg, 1)}kg` },
        { label: "Estimated cover", value: `${row.daysUntilRunout} day${row.daysUntilRunout === 1 ? "" : "s"}` },
      ],
      suggestedAction: "Consider ordering more before you run out.",
      confidence: capConfidence(baseConfidence, cap),
      generatedDate,
      priorityRank: 4,
    });
  }

  return recommendations.sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
    return CONFIDENCE_ORDER[b.confidence] - CONFIDENCE_ORDER[a.confidence];
  });
}

// ---------------------------------------------------------------------------
// Data quality (Feature 10) — tells the owner how far to trust the guidance.
// ---------------------------------------------------------------------------
export type DataQualityInput = {
  productCount: number;
  missingCostCount: number;
  missingPriceCount: number;
  missingStockInfoCount: number;
  supplierCount: number;
  missingCertificateCount: number;
};

export type DataQuality = {
  score: number;
  band: "high" | "medium" | "low";
  confidenceCap: PurchasingConfidence;
  breakdown: Array<{ label: string; value: number }>;
};

export function buildDataQuality(input: DataQualityInput): DataQuality {
  const productBase = Math.max(1, input.productCount);
  const supplierBase = Math.max(1, input.supplierCount);

  // Each fraction is "share of records missing this field", in [0, 1].
  const fractions = [
    Math.min(1, input.missingCostCount / productBase),
    Math.min(1, input.missingPriceCount / productBase),
    Math.min(1, input.missingStockInfoCount / productBase),
    Math.min(1, input.missingCertificateCount / supplierBase),
  ];
  const averageMissing = fractions.reduce((total, value) => total + value, 0) / fractions.length;
  const score = input.productCount === 0 ? 0 : Math.round((1 - averageMissing) * 100);

  const band = score >= 90 ? "high" : score >= 70 ? "medium" : "low";
  const confidenceCap: PurchasingConfidence = band === "high" ? "high" : band === "medium" ? "medium" : "low";

  return {
    score,
    band,
    confidenceCap,
    breakdown: [
      { label: "Missing costs", value: input.missingCostCount },
      { label: "Missing prices", value: input.missingPriceCount },
      { label: "Missing stock info", value: input.missingStockInfoCount },
      { label: "Missing certificates", value: input.missingCertificateCount },
    ],
  };
}

// ---------------------------------------------------------------------------
// Products needing attention (Feature 2) — data gaps that are bigger business
// risks than any analytic. Consolidated into one list.
// ---------------------------------------------------------------------------
export type ProductDataInput = {
  productName: string;
  isActive: boolean;
  pricePerUnit: number;
  hasCost: boolean;
  unitsSold: number;
  hasStockInfo: boolean;
};

export type ProductNeedingAttention = {
  productName: string;
  issues: string[];
};

export function buildProductsNeedingAttention(products: ProductDataInput[]): ProductNeedingAttention[] {
  return products
    .map((product) => {
      const issues: string[] = [];
      if (!(product.pricePerUnit > 0)) issues.push("No sale price set");
      if (!product.hasCost) issues.push("No cost price — margin can't be calculated");
      if (!product.isActive) issues.push("Inactive — hidden from the shop");
      if (product.unitsSold <= 0) issues.push("No sales recorded yet");
      if (!product.hasStockInfo) issues.push("No stock information");
      return { productName: product.productName, issues };
    })
    .filter((product) => product.issues.length > 0)
    // Most-broken first.
    .sort((a, b) => b.issues.length - a.issues.length);
}

// ---------------------------------------------------------------------------
// Supplier readiness (Feature 8) — a plain checklist answering "am I ready to
// place an order?" Reuses the same honesty rules: only ticks what it can verify.
// ---------------------------------------------------------------------------
export type SupplierReadinessInput = {
  missingCostCount: number;
  marginVisibleCount: number;
  weeklyWasteValue: number;
  expiringStockCount: number;
  expiredCertificateCount: number;
  hasUrgentReorder: boolean;
  seasonalEventApproaching: boolean;
};

export type SupplierReadinessItem = { label: string; ok: boolean; detail: string };
export type SupplierReadiness = {
  overall: "ready" | "needs_review";
  items: SupplierReadinessItem[];
};

export function buildSupplierReadiness(input: SupplierReadinessInput, wasteThreshold = 20): SupplierReadiness {
  const items: SupplierReadinessItem[] = [
    {
      label: "Products have costs",
      ok: input.missingCostCount === 0,
      detail:
        input.missingCostCount === 0
          ? "Every product has a cost — margins can be calculated."
          : `${input.missingCostCount} product(s) have no cost. Enter costs to see true margin before ordering.`,
    },
    {
      label: "Margins are visible",
      ok: input.marginVisibleCount > 0,
      detail: input.marginVisibleCount > 0 ? `${input.marginVisibleCount} product(s) show a margin.` : "No product margins available yet — enter costs.",
    },
    {
      label: "Waste is under control",
      ok: input.weeklyWasteValue <= wasteThreshold,
      detail: `${`£${input.weeklyWasteValue.toFixed(2)}`} of waste this week.`,
    },
    {
      label: "Expiring stock addressed",
      ok: input.expiringStockCount === 0,
      detail:
        input.expiringStockCount === 0
          ? "No stock expiring imminently."
          : `${input.expiringStockCount} batch(es) expiring soon — use or discount before re-ordering.`,
    },
    {
      label: "Certificates in date",
      ok: input.expiredCertificateCount === 0,
      detail: input.expiredCertificateCount === 0 ? "No expired supplier certificates." : `${input.expiredCertificateCount} certificate(s) expired.`,
    },
    {
      label: "Stock level checked",
      ok: true,
      detail: input.hasUrgentReorder ? "Some products are low — see the order-more list above." : "No products are about to run out.",
    },
    {
      label: "Seasonal events",
      ok: true,
      detail: input.seasonalEventApproaching ? "A peak day is approaching — factor it into this order." : "No peak day within the planning window.",
    },
  ];

  // Only the genuinely blocking checks decide overall readiness.
  const blocking = [items[0], items[3], items[4]];
  const overall = blocking.every((item) => item?.ok) ? "ready" : "needs_review";

  return { overall, items };
}
