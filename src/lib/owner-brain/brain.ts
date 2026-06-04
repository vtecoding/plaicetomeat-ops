/**
 * V9 Owner Brain — the orchestrator.
 *
 * `buildOwnerBrain` is the single pure entry point: hand it a V8 `ShopIntelligence` and
 * it returns the compressed Owner Brain picture — setup mode, shop status in words, and
 * the three decision buckets (Urgent ≤5 / Important ≤10 / Opportunities), each ranked by
 * money at stake. It never performs I/O and never mutates its input.
 *
 * The spec-named module `src/lib/domain/owner-brain.ts` re-exports this.
 */
import type { ShopIntelligence } from "@/lib/shop-intelligence/types";
import { rankDecisions, toOwnerDecision } from "./decisions";
import { buildShopStatus } from "./status";
import { buildOwnerWeeklySummary } from "./weekly-summary";
import type { OwnerBrain, OwnerDecision } from "./types";

const MAX_URGENT = 5;
const MAX_IMPORTANT = 10;
const MAX_OPPORTUNITIES = 6;

/** True once the shop has the two foundations that make intelligence meaningful. */
function hasFoundations(intel: ShopIntelligence): boolean {
  const done = (id: string) => intel.gettingStarted.steps.find((step) => step.id === id)?.done ?? false;
  return done("list-products") && done("record-stock");
}

export function buildOwnerBrain(intel: ShopIntelligence): OwnerBrain {
  // Setup mode means a genuinely new/empty shop — no products or no stock yet. We do NOT
  // gate on costs or certificates: those are real decisions (e.g. "selling with no cost
  // recorded"), so hiding them behind setup mode would bury exactly what the owner needs.
  const setupMode = !intel.dataConfigured || !hasFoundations(intel);

  const decisions = intel.findings.map(toOwnerDecision);
  const urgent = rankDecisions(decisions.filter((d) => d.category === "urgent")).slice(0, MAX_URGENT);
  const important = rankDecisions(decisions.filter((d) => d.category === "important")).slice(0, MAX_IMPORTANT);
  const opportunities = rankDecisions(decisions.filter((d) => d.category === "opportunity")).slice(0, MAX_OPPORTUNITIES);

  const buckets = setupMode
    ? { urgent: [] as OwnerDecision[], important: [] as OwnerDecision[], opportunities: [] as OwnerDecision[] }
    : { urgent, important, opportunities };

  return {
    generatedAt: intel.generatedAt,
    setupMode,
    gettingStarted: intel.gettingStarted,
    status: buildShopStatus(intel.health),
    urgent: buckets.urgent,
    important: buckets.important,
    opportunities: buckets.opportunities,
    weekly: buildOwnerWeeklySummary(intel, buckets),
  };
}

// Re-export the public surface so callers can import from one place.
export * from "./types";
export { deJargon, findForbiddenTerms, FORBIDDEN_TERMS } from "./language";
export { estimateMoneyImpact, formatMoneyImpact, moneyMagnitude, isUpsideFinding } from "./money";
export { toOwnerDecision, categorise, rankDecisions } from "./decisions";
export { buildShopStatus } from "./status";
export { buildOwnerWeeklySummary } from "./weekly-summary";
export { buildDayShape } from "./day";

// Find one decision across all buckets (used by the decision detail page).
export function findDecision(brain: OwnerBrain, id: string): OwnerDecision | null {
  return [...brain.urgent, ...brain.important, ...brain.opportunities].find((d) => d.id === id) ?? null;
}
