import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildBasketActions(input: ActionEngineInput): OwnerAction[] {
  const top = input.basket.topPairings[0];
  if (input.basket.status !== "ready" || !top || !input.basket.bundleSuggestion) return [];

  return [
    {
      id: `basket-${slug(top.productA)}-${slug(top.productB)}-bundle`,
      category: "basket",
      group: "customer_growth",
      severity: "info",
      title: `${top.productA} and ${top.productB} are a bundle opportunity`,
      explanation: `${top.count} real orders include both ${top.productA} and ${top.productB}.`,
      estimatedImpact: "A bundle can lift average basket value without guessing demand.",
      recommendedAction: input.basket.bundleSuggestion,
      sourceMetrics: {
        productA: top.productA,
        productB: top.productB,
        pairingCount: top.count,
        realOrderCount: input.basket.realOrderCount,
      },
      createdAt: input.createdAt,
      confidence: "medium",
    },
  ];
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
