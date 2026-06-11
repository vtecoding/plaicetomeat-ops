import type { ActionEngineInput, OwnerAction } from "./action-types";

/**
 * Customer-return guidance (V16). Two shapes:
 *
 *  1. WIN-BACK (the money-making one) — a *named* regular who has gone quiet. Stock, waste
 *     and compliance intelligence protect money; this is the engine that creates it. Each
 *     lapsed regular is one action: who to call, and the basket value they're worth.
 *  2. AGGREGATE fallback — when there's no named regular to chase but repeat custom is broadly
 *     low, a gentle "recent customers aren't coming back" nudge.
 *
 * `repeatRate` is an integer percentage (0–100) kept in `sourceMetrics` only — never written
 * into a display string, so no `%` leaks onto the operator surface.
 */
const LOW_REPEAT_RATE = 25;
const MIN_SAMPLE = 3;
const MAX_WINBACK_ACTIONS = 3;

export function buildCustomerActions(input: ActionEngineInput): OwnerAction[] {
  const winBacks = (input.customers.lapsedRegulars ?? []).slice(0, MAX_WINBACK_ACTIONS).map((customer, index) => ({
    id: `customer-winback-${slug(customer.customerName)}-${index}`,
    category: "customer" as const,
    group: "customer_growth" as const,
    severity: "info" as const,
    title: `Win back ${customer.customerName}`,
    explanation: `${customer.customerName} was a regular but hasn't ordered in ${weeksAway(customer.daysSinceLastOrder)}.${
      customer.favouriteProduct ? ` They usually buy ${customer.favouriteProduct}.` : ""
    }`,
    estimatedImpact: `Potential revenue: ${formatMoney(customer.averageOrderValue)} a visit.`,
    recommendedAction: `Call or message ${customer.customerName} with a return offer.`,
    sourceMetrics: {
      customerName: customer.customerName,
      daysSinceLastOrder: customer.daysSinceLastOrder,
      averageOrderValue: customer.averageOrderValue,
      orders: customer.orders,
    },
    createdAt: input.createdAt,
    confidence: "medium" as const,
  }));

  if (winBacks.length > 0) return winBacks;

  // No named regular to chase — fall back to the broad signal if repeat custom is low across a
  // meaningful sample (and there's at least one newcomer to win over).
  const { firstTimeCustomers, repeatCustomers, repeatRate } = input.customers;
  const totalCustomers = firstTimeCustomers + repeatCustomers;
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

/** Whole weeks since their last order — always ≥3 by the time a regular counts as lapsed. */
function weeksAway(days: number): string {
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const moneyFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}
