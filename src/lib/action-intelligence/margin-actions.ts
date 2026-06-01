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
      title: `${target.productName} has waste dragging margin`,
      explanation:
        target.grossProfit !== null
          ? `${target.productName} is showing ${formatMoney(target.grossProfit)} estimated gross profit after ${formatMoney(target.wasteCost)} waste.`
          : `${target.productName} has ${formatMoney(target.wasteCost)} waste cost, but margin cannot be completed without product cost.`,
      estimatedImpact: `${formatMoney(target.wasteCost)} waste drag identified.`,
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

function formatMoney(value: number) {
  return `£${value.toFixed(2)}`;
}
