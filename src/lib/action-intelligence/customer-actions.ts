import type { ActionEngineInput, OwnerAction } from "./action-types";

/**
 * Customer-return guidance (V16). The old rule fired only when the repeat rate was
 * *exactly* zero — brittle: a shop with one returning customer in fifty (a 2% repeat
 * rate) got nothing. This fires whenever repeat custom is low across a meaningful
 * sample, so "almost nobody is coming back" is surfaced too.
 *
 * `repeatRate` is an integer percentage (0–100). It is kept in `sourceMetrics` only —
 * never written into a display string, so no `%` leaks onto the operator surface.
 *
 * NOTE: the per-customer "regular absent 21 days — call them" action (V16.7's flagship)
 * needs last-order / frequency / basket history that `ActionEngineInput.customers` does
 * not carry yet; that is a snapshot/query addition, deferred. See docs/v16/00-Reality-Map.
 */
const LOW_REPEAT_RATE = 25;
const MIN_SAMPLE = 3;

export function buildCustomerActions(input: ActionEngineInput): OwnerAction[] {
  const { firstTimeCustomers, repeatCustomers, repeatRate } = input.customers;
  const totalCustomers = firstTimeCustomers + repeatCustomers;

  // Need a few customers before "they aren't coming back" means anything, at least one
  // newcomer to win back, and a genuinely low repeat rate.
  if (firstTimeCustomers <= 0 || totalCustomers < MIN_SAMPLE || repeatRate > LOW_REPEAT_RATE) return [];

  return [
    {
      id: "customer-repeat-rate-follow-up",
      category: "customer",
      group: "customer_growth",
      severity: "info",
      title: "Recent customers have not returned",
      explanation: `${firstTimeCustomers} first-time customers recorded, and few are coming back.`,
      estimatedImpact: "Potential impact: increased repeat purchases.",
      recommendedAction: "Consider contacting them with a return offer.",
      sourceMetrics: {
        firstTimeCustomers,
        repeatCustomers,
        repeatRate,
      },
      createdAt: input.createdAt,
      confidence: "medium",
    },
  ];
}
