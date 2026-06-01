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
      title: `${top.label} is driving most waste`,
      explanation: `${top.label} accounts for ${formatMoney(top.value)} of waste this week.`,
      estimatedImpact: `Reducing over-ordering could protect up to ${formatMoney(top.value)} this week.`,
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

function formatMoney(value: number) {
  return `£${value.toFixed(2)}`;
}
