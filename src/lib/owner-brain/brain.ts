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
import { compressActions } from "./action-compression";
import { rankDecisions, toOwnerDecision } from "./decisions";
import { toOperatorActions } from "./operator-action";
import { buildShopStatus } from "./status";
import { buildOwnerWeeklySummary } from "./weekly-summary";
import type { ActionEvidence, DecisionDiagnostics, OperatorAction, OwnerBrain, ScoredAction } from "./types";

const MAX_URGENT = 5;
const MAX_IMPORTANT = 10;
const MAX_OPPORTUNITIES = 6;

/** True once the shop has the two foundations that make intelligence meaningful. */
function hasFoundations(intel: ShopIntelligence): boolean {
  const done = (id: string) => intel.gettingStarted.steps.find((step) => step.id === id)?.done ?? false;
  return done("list-products") && done("record-stock");
}

/**
 * The INTERNAL decision engine. Runs the full scored pipeline — rank into capped buckets +
 * the single global compression contest — and returns the scored picture and its ranking
 * evidence. This output is internal: it must be converted via `toOperatorAction` before it
 * can reach the UI. Shared by {@link buildOwnerBrain} and {@link getDecisionDiagnostics} so
 * the pipeline runs once per caller and the two stay in lock-step.
 */
function runDecisionEngine(intel: ShopIntelligence): DecisionDiagnostics & { setupMode: boolean } {
  // Setup mode means a genuinely new/empty shop — no products or no stock yet. We do NOT
  // gate on costs or certificates: those are real decisions (e.g. "selling with no cost
  // recorded"), so hiding them behind setup mode would bury exactly what the owner needs.
  const setupMode = !intel.dataConfigured || !hasFoundations(intel);

  if (setupMode) {
    const none: ScoredAction[] = [];
    return { setupMode, doNow: none, later: none, urgent: none, important: none, opportunities: none, evidence: [] as ActionEvidence[] };
  }

  const decisions = intel.findings.map(toOwnerDecision);
  const urgent = rankDecisions(decisions.filter((d) => d.category === "urgent")).slice(0, MAX_URGENT);
  const important = rankDecisions(decisions.filter((d) => d.category === "important")).slice(0, MAX_IMPORTANT);
  const opportunities = rankDecisions(decisions.filter((d) => d.category === "opportunity")).slice(0, MAX_OPPORTUNITIES);

  // V15 — the single global contest. Every decision competes in one field (not in the
  // separate capped buckets above) and the butcher is shown only the top three.
  const compressed = compressActions(decisions);

  return {
    setupMode,
    doNow: compressed.doNow,
    later: compressed.later,
    evidence: compressed.evidence,
    urgent,
    important,
    opportunities,
  };
}

/**
 * Build the OPERATOR-SAFE Owner Brain. Runs the internal engine, then crosses the V15.4
 * firewall via `toOperatorAction` so every action handed to the UI is an `OperatorAction`
 * with no scores, confidence or evidence. The scored picture never appears on the result.
 */
export function buildOwnerBrain(intel: ShopIntelligence): OwnerBrain {
  const engine = runDecisionEngine(intel);
  const buckets = { urgent: engine.urgent, important: engine.important, opportunities: engine.opportunities };

  return {
    generatedAt: intel.generatedAt,
    setupMode: engine.setupMode,
    gettingStarted: intel.gettingStarted,
    status: buildShopStatus(intel.health),
    doNow: toOperatorActions(engine.doNow),
    later: toOperatorActions(engine.later),
    walkSteps: toOperatorActions([...engine.urgent, ...engine.important]),
    opportunityCount: engine.opportunities.length,
    weekly: buildOwnerWeeklySummary(intel, buckets),
  };
}

/**
 * V15.4 — the INTERNAL diagnostics path. Returns the scored picture + ranking evidence for
 * audit, explainability and dev tooling. It is intentionally separate from the operator
 * brain and must NEVER be imported by an operator-facing surface.
 */
export function getDecisionDiagnostics(intel: ShopIntelligence): DecisionDiagnostics {
  const { doNow, later, urgent, important, opportunities, evidence } = runDecisionEngine(intel);
  return { doNow, later, urgent, important, opportunities, evidence };
}

// Re-export the public surface so callers can import from one place.
export * from "./types";
export { deJargon, findForbiddenTerms, FORBIDDEN_TERMS } from "./language";
export { estimateMoneyImpact, formatMoneyImpact, moneyMagnitude, isUpsideFinding } from "./money";
export { toOwnerDecision, categorise, rankDecisions } from "./decisions";
export { buildShopStatus } from "./status";
export { buildOwnerWeeklySummary } from "./weekly-summary";
export { buildDayShape } from "./day";
export { compressActions, classifyDoctrine, compareActions, DO_NOW_MAX, DOCTRINE_RANK } from "./action-compression";
export { resolveActionTarget, classifyActionType, ACTION_VERB, type ActionTarget, type ActionType } from "./action-target";
export { toOperatorAction, toOperatorActions } from "./operator-action";
export { buildMorningBriefing, BRIEFING_WORD_LIMIT } from "./briefing";

// Find one operator action (used by the decision detail page). doNow + later + the walk
// steps together hold every action the operator can click; they are already operator-safe.
export function findDecision(brain: OwnerBrain, id: string): OperatorAction | null {
  return [...brain.doNow, ...brain.later, ...brain.walkSteps].find((action) => action.id === id) ?? null;
}
