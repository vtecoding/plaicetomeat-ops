import { detectMarginErosion } from "@/lib/domain/margin-erosion";
import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildMarginActions(input: ActionEngineInput): OwnerAction[] {
  return [...buildErosionActions(input), ...buildWasteDragActions(input)];
}

/**
 * The silent leak: supplier cost rose but the price didn't follow. A recommendation, not a
 * change — it shows the money lost per kg and a suggested price, and the owner decides.
 * The relative drop stays in sourceMetrics only, so no `%` reaches the strict surface.
 */
function buildErosionActions(input: ActionEngineInput): OwnerAction[] {
  return detectMarginErosion(input.marginErosion ?? []).map((finding) => ({
    id: `margin-erosion-${slug(finding.productName)}`,
    category: "margin" as const,
    group: "money_saving" as const,
    severity: "info" as const,
    title: `${finding.productName} margin has slipped`,
    explanation: `Supplier cost rose from ${formatMoney(finding.priorCostPerKg)}/kg to ${formatMoney(finding.currentCostPerKg)}/kg — you're earning less on every kilo sold.`,
    estimatedImpact: `About ${formatMoney(finding.perKgProfitDrop)} less profit per kg.`,
    recommendedAction: `Review the price — about ${formatMoney(finding.suggestedPricePerKg)}/kg would restore your margin. Owner decides; nothing changes on its own.`,
    sourceMetrics: {
      productName: finding.productName,
      pricePerKg: finding.pricePerKg,
      currentCostPerKg: finding.currentCostPerKg,
      priorCostPerKg: finding.priorCostPerKg,
      suggestedPricePerKg: finding.suggestedPricePerKg,
      marginDropPct: finding.marginDropPct,
    },
    createdAt: input.createdAt,
    confidence: "medium" as const,
  }));
}

function buildWasteDragActions(input: ActionEngineInput): OwnerAction[] {
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
