import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildStockActions(input: ActionEngineInput): OwnerAction[] {
  return input.expiringStock
    .filter((item) => item.valueAtRisk > 0 && item.daysToExpiry <= 3)
    .slice(0, 3)
    .map((item) => ({
      id: `stock-${slug(item.productName)}-${item.daysToExpiry}`,
      category: "stock",
      group: item.daysToExpiry < 0 ? "urgent" : "stock",
      severity: item.daysToExpiry < 0 ? "urgent" : "warning",
      title:
        item.daysToExpiry < 0
          ? `${item.productName} is expired stock`
          : `${item.productName} has stock expiring soon`,
      explanation:
        item.daysToExpiry < 0
          ? `${item.productName} is past expiry with value still at risk.`
          : `${item.productName} has ${item.remainingWeightKg.toFixed(3)}kg expiring within ${item.daysToExpiry} days.`,
      estimatedImpact: `${formatMoney(item.valueAtRisk)} stock value at risk.`,
      recommendedAction:
        item.daysToExpiry < 0
          ? "Record disposal as waste and remove it from available prep immediately."
          : `Create a short-dated offer, add ${item.productName} to a bundle, or prioritise prep today.`,
      sourceMetrics: {
        productName: item.productName,
        remainingWeightKg: item.remainingWeightKg,
        valueAtRisk: item.valueAtRisk,
        daysToExpiry: item.daysToExpiry,
      },
      createdAt: input.createdAt,
      confidence: "high",
    }));
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatMoney(value: number) {
  return `£${value.toFixed(2)}`;
}
