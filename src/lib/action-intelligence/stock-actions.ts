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
          : `${item.productName} has ${item.remainingWeightKg.toFixed(3)}kg ${expiryPhrase(item.daysToExpiry)}.`,
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

/**
 * Plain-English expiry wording for decision cards. "within 0 days" is robot-speak — a
 * batch dated today should read "expiring today", tomorrow's "expiring tomorrow", and
 * only beyond that do we fall back to a day count.
 */
function expiryPhrase(daysToExpiry: number) {
  if (daysToExpiry <= 0) return "expiring today";
  if (daysToExpiry === 1) return "expiring tomorrow";
  return `expiring within ${daysToExpiry} days`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const moneyFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}
