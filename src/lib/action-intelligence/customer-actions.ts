import type { ActionEngineInput, OwnerAction } from "./action-types";

export function buildCustomerActions(input: ActionEngineInput): OwnerAction[] {
  if (input.customers.repeatRate !== 0 || input.customers.firstTimeCustomers <= 0) return [];

  return [
    {
      id: "customer-repeat-rate-follow-up",
      category: "customer",
      group: "customer_growth",
      severity: "info",
      title: "First-time customers are not repeating yet",
      explanation: `${input.customers.firstTimeCustomers} first-time customers are recorded and repeat rate is 0%.`,
      estimatedImpact: "A follow-up offer can turn first orders into second orders.",
      recommendedAction: "Send a loyalty or next-order offer to recent first-time customers.",
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
