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
          ? `Check ${item.productName} now`
          : `Sell ${item.productName} first`,
      explanation:
        item.daysToExpiry < 0
          ? "This stock may no longer be sellable."
          : `${item.productName} is ${expiryPhrase(item.daysToExpiry)}.`,
      estimatedImpact: `Potential value at risk: ${formatMoney(item.valueAtRisk)}.`,
      recommendedAction:
        item.daysToExpiry < 0
          ? `Check ${item.productName} now and record waste if needed.`
          : "Sell this first.",
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
  if (daysToExpiry <= 0) return "short-dated today";
  if (daysToExpiry === 1) return "short-dated tomorrow";
  return "short-dated";
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const moneyFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}
