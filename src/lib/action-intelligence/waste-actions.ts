import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildWasteActions(input: ActionEngineInput): OwnerAction[] {
  if (input.waste.weekValue <= 0) return [];
  const top = input.waste.byProduct[0];
  if (!top || top.value / input.waste.weekValue <= 0.5) return [];

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
        totalWasteThisWeek: input.waste.weekValue,
        wasteSharePercent: Math.round((top.value / input.waste.weekValue) * 100),
      },
      createdAt: input.createdAt,
      confidence: "medium",
    },
  ];
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const moneyFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}
