import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildCustomerActions(input: ActionEngineInput): OwnerAction[] {
  if (input.customers.repeatRate !== 0 || input.customers.firstTimeCustomers <= 0) return [];

  return [
    {
      id: "customer-repeat-rate-follow-up",
      category: "customer",
      group: "customer_growth",
      severity: "info",
      title: "Recent customers have not returned",
      explanation: `${input.customers.firstTimeCustomers} first-time customers recorded.`,
      estimatedImpact: "Potential impact: increased repeat purchases.",
      recommendedAction: "Consider contacting them with a return offer.",
      sourceMetrics: {
        firstTimeCustomers: input.customers.firstTimeCustomers,
        repeatCustomers: input.customers.repeatCustomers,
        repeatRate: input.customers.repeatRate,
      },
      createdAt: input.createdAt,
      confidence: "medium",
    },
  ];
}
