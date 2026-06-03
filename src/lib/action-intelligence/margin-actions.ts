import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildMarginActions(input: ActionEngineInput): OwnerAction[] {
  const wasteDrag = input.margin.highestWasteDrag;
  const worstNegative = input.margin.worst.find((product) => (product.grossProfit ?? 0) < 0 && product.wasteCost > 0);

  if (!worstNegative && (!wasteDrag || wasteDrag.wasteCost <= 0)) return [];

  const target = worstNegative ?? wasteDrag;
  if (!target) return [];

  return [
    {
      id: `margin-${slug(target.productName)}-waste-drag`,
      category: "margin",
      group: "money_saving",
      severity: worstNegative ? "warning" : "info",
      title: `${target.productName} is losing money`,
      explanation:
        target.grossProfit !== null
          ? `${target.productName} is showing ${formatMoney(target.grossProfit)} estimated profit after ${formatMoney(target.wasteCost)} waste.`
          : `${target.productName} has ${formatMoney(target.wasteCost)} of waste, but its cost hasn't been entered yet so profit can't be shown.`,
      estimatedImpact: `Potential saving: ${formatMoney(target.wasteCost)} waste reduction opportunity.`,
      recommendedAction: `Review ${target.productName} ordering and prep plan before the next supplier order.`,
      sourceMetrics: {
        productName: target.productName,
        grossProfit: target.grossProfit,
        wasteCost: target.wasteCost,
      },
      createdAt: input.createdAt,
      confidence: target.grossProfit === null ? "low" : "medium",
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
