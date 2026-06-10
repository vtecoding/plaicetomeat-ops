/**
 * V15.2 — One-Tap Action Layer · the Action Target Contract.
 * ==========================================================
 * V15.0/V15.1 chose *what* the butcher should do and *why*. V15.2 answers the third
 * question — *where* the work is done — and removes it from the operator's head: every
 * primary action resolves to a single destination with the exact item pre-focused, so the
 * operator taps once and arrives at the work instead of reading, remembering, navigating
 * and searching.
 *
 * Hard invariants
 * ---------------
 * - Pure: no I/O, never mutates the decision. It only *reads* the same structured signals
 *   the V15 ranking already reads (`area`, `id`, the recommended-action verb) so routing
 *   can never disagree with how an action was ranked.
 * - One tap to the *work*, never to *execute*. Every destination is a read/work screen the
 *   operator drives by hand — there is no path here that changes stock, prices, orders,
 *   discounts or compliance on its own (V15.2 Mission 9).
 */
import type { ActionType, OwnerDecision } from "./types";

// `ActionType` is defined in `./types` (so the external OperatorAction can reference it
// without a circular import). Re-exported here to keep the action-target public surface stable.
export type { ActionType };

/**
 * Where a primary action sends the operator, and what it should already know on arrival.
 * `href` is a plain GET navigation — tapping it can only ever *open* the work.
 */
export type ActionTarget = {
  actionType: ActionType;
  /** The destination route, e.g. `/admin/stock-count`. */
  destination: string;
  /** Human name of the item to focus, e.g. "Chicken Breast" (null when none applies). */
  entityLabel: string | null;
  /** Stable slug used to pre-select the item on arrival, e.g. "chicken-breast". */
  entitySlug: string | null;
  /** One plain-English line telling the destination why the operator arrived. */
  reason: string;
  /** The one-tap link: destination + the context the page reads to focus the item. */
  href: string;
};

/** Display verb for each action type, for the destination banner. */
export const ACTION_VERB: Record<ActionType, string> = {
  count: "Count",
  order: "Order",
  sell: "Sell",
  fix: "Fix",
  review: "Review",
};

/** Where each kind of work is actually done. Read/work screens only — no mutation endpoints. */
const DESTINATION: Record<ActionType, string> = {
  count: "/admin/stock-count",
  order: "/admin/purchasing",
  sell: "/admin/inventory",
  fix: "/admin/compliance",
  review: "/admin/today", // placeholder — review resolves to the decision's own detail page
};

const OPERATOR_PREFIXES = [
  "operator-count-",
  "operator-order-less-",
  "operator-order-",
  "operator-sell-first-",
] as const;

/** Slug ↔ name, mirrors the slug used when operator-guidance built the decision id. */
function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Pull the product slug back out of an operator-action id. The ids were built as
 * `operator-count-<slug>`, `operator-order[-less]-<slug>` and
 * `operator-sell-first-<slug>-<daysToExpiry>` (days can be negative). We strip the known
 * prefix and, for sell-first, the trailing day count — leaving exactly `slug(productName)`.
 */
function entitySlugFromId(id: string): string | null {
  for (const prefix of OPERATOR_PREFIXES) {
    if (id.startsWith(prefix)) {
      const rest = id.slice(prefix.length);
      const slug = prefix === "operator-sell-first-" ? rest.replace(/-(-?\d+)$/, "") : rest;
      return slug.length > 0 ? slug : null;
    }
  }
  return null;
}

/** Classify a decision into the operator verb. Reuses the same signals as V15 ranking. */
export function classifyActionType(decision: OwnerDecision): ActionType {
  const area = decision.area;
  const action = (decision.recommendedAction ?? "").toLowerCase();
  const id = decision.id ?? "";

  // Losing the right to sell the meat (food-safety / halal) is fixed in compliance.
  if (area === "compliance") return "fix";

  // Expired stock the operator must check and (manually) record as waste — done at the
  // single stock correction door, not a "sell".
  if (/record waste|no longer be sellable/.test(action)) return "fix";

  // Short-dated stock we can still save by selling it first → the product's live context.
  if (/^sell\b/.test(action) || id.startsWith("operator-sell-first") || area === "expiry") return "sell";

  // Running out / buying less → purchasing.
  if (/^order\b/.test(action) || id.startsWith("operator-order-")) return "order";

  // Keeping the count honest → the stock-count screen.
  if (/^count\b/.test(action) || /please count/.test(action) || id.startsWith("operator-count")) return "count";

  // Everything else (margin / yield / other owner-action findings) has no dedicated work
  // screen — the operator reviews it on the decision's own detail page.
  return "review";
}

/**
 * Resolve one decision to its one-tap target. `review` keeps the existing read-only detail
 * page (no work screen exists for those findings); every other type carries the focus
 * context in the URL so it survives a refresh without a server round-trip.
 */
export function resolveActionTarget(decision: OwnerDecision): ActionTarget {
  const actionType = classifyActionType(decision);
  const reason = (decision.whatHappened || decision.whyItMatters || "").trim();

  if (actionType === "review") {
    return {
      actionType,
      destination: `/admin/today/${decision.id}`,
      entityLabel: null,
      entitySlug: null,
      reason,
      href: `/admin/today/${decision.id}`,
    };
  }

  // A "fix" splits by what's broken: a food-safety/halal certificate is fixed in
  // compliance (keyed by supplier — no per-item slug the decision carries), while expired
  // stock is checked and written off at the single stock correction door, focused on the item.
  const complianceFix = actionType === "fix" && decision.area === "compliance";
  const destination = actionType === "fix" && !complianceFix ? "/admin/stock-count" : DESTINATION[actionType];
  const entitySlug = complianceFix ? null : entitySlugFromId(decision.id);
  const entityLabel = entitySlug ? slugToLabel(entitySlug) : null;

  const params = new URLSearchParams();
  if (entitySlug) params.set("focus", entitySlug);
  params.set("do", actionType);
  params.set("from", "today");
  if (reason) params.set("why", reason);

  // Order lands on a server-rendered card, so a hash anchor scrolls straight to it; the
  // count/sell screens highlight + scroll on the client instead.
  const hash = actionType === "order" && entitySlug ? `#${entitySlug}` : "";

  return {
    actionType,
    destination,
    entityLabel,
    entitySlug,
    reason,
    href: `${destination}?${params.toString()}${hash}`,
  };
}
