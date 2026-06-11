import type { ActionEngineInput, OwnerAction } from "./action-types";

/**
 * Waste guidance (V16). Two mutually-exclusive shapes of the same week's waste:
 *
 *  1. CONCENTRATED — one product is more than half of the week's waste. Name it and
 *     point at the order/short-dated lever directly.
 *  2. DIFFUSE — no single product dominates, but the week's total is still material
 *     once it's added up across several lines. Without this, spread-out waste is
 *     invisible: the old engine emitted nothing unless one product crossed 50%, so a
 *     shop bleeding £40 across eight products saw no guidance at all.
 *
 * Expiry-window risk (short-dated / out-of-date batches) is deliberately NOT handled
 * here — it is already covered by the stock and operator-guidance engines, and
 * duplicating it would only give the compression engine more to dedupe.
 */
export function buildWasteActions(input: ActionEngineInput): OwnerAction[] {
  const { weekValue, byProduct } = input.waste;
  if (weekValue <= 0) return [];

  const top = byProduct[0];

  // 1. Concentrated — one product carries more than half the week's waste.
  if (top && top.value / weekValue > 0.5) {
    return [
      {
        id: `waste-${slug(top.label)}-reduce-order`,
        category: "waste",
        group: "money_saving",
        severity: "warning",
        title: `${top.label} is costing money`,
        explanation: `${formatMoney(top.value)} wasted this week.`,
        estimatedImpact: `Potential saving: ${formatMoney(top.value)} this week.`,
        recommendedAction: `Reduce next ${top.label} order by 10-20% unless weekend demand is expected, or create a short-dated offer.`,
        sourceMetrics: {
          productName: top.label,
          wasteThisWeek: top.value,
          totalWasteThisWeek: weekValue,
          wasteSharePercent: Math.round((top.value / weekValue) * 100),
        },
        createdAt: input.createdAt,
        confidence: "medium",
      },
    ];
  }

  // 2. Diffuse — material total, but spread across the counter with none standing out.
  if (weekValue >= MATERIAL_WEEK_WASTE && byProduct.length >= 2) {
    return [
      {
        id: "waste-week-review",
        category: "waste",
        group: "money_saving",
        severity: "info",
        title: "Waste is adding up this week",
        explanation: `${formatMoney(weekValue)} wasted this week across ${byProduct.length} products, with none standing out.`,
        estimatedImpact: `Potential saving: ${formatMoney(weekValue)} this week.`,
        recommendedAction:
          "Review trimming, ordering and short-dated stock across your main lines — small savings on several products add up.",
        sourceMetrics: {
          totalWasteThisWeek: weekValue,
          productsWithWaste: byProduct.length,
          topProduct: top?.label ?? null,
        },
        createdAt: input.createdAt,
        confidence: "medium",
      },
    ];
  }

  return [];
}

/** Below this, diffuse waste isn't worth a nudge — small spread waste is normal trade. */
const MATERIAL_WEEK_WASTE = 20;

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const moneyFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}
