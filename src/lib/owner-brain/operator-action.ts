/**
 * V15.4 — Intelligence Firewall · the transformation boundary.
 * ============================================================
 * The ONE allowed path from the Decision Engine to the operator UI:
 *
 *     ScoredAction  →  toOperatorAction()  →  OperatorAction
 *
 * Everything internal and numeric (priority, category/severity, basis confidence, ranking
 * evidence) stops here. What comes out the other side is a flat bag of safe display
 * strings the butcher can read — structurally incapable of carrying a calculation.
 *
 * Pure: no I/O, never mutates input.
 */
import { resolveActionTarget } from "./action-target";
import { DUE_WINDOW_LABEL, type OperatorAction, type ScoredAction } from "./types";

/**
 * Convert one internal scored action into the external operator action. Internal fields
 * (`priority`, `category`, `sourceEvidence.basis.confidence`, …) are deliberately dropped —
 * only the safe, already-plain display strings survive.
 */
export function toOperatorAction(scored: ScoredAction): OperatorAction {
  // The one-tap target (V15.2) is itself part of this conversion — it reads internal fields
  // (area / id / verb) and returns only safe routing strings.
  const target = resolveActionTarget(scored);
  const impact = scored.estimatedImpact;
  const reason = impact.kind !== "none" ? impact.label : scored.whatHappened || scored.whyItMatters;

  return {
    id: scored.id,
    actionType: target.actionType,
    title: scored.title,
    whatHappened: scored.whatHappened,
    whyItMatters: scored.whyItMatters,
    recommendedAction: scored.recommendedAction,
    reason,
    impactLabel: impact.label,
    impactTone: impact.kind,
    owner: scored.owner,
    dueLabel: DUE_WINDOW_LABEL[scored.dueWindow],
    destination: target.destination,
    entityLabel: target.entityLabel,
    href: target.href,
    // Plain summary text only — the basis confidence value is intentionally NOT carried over.
    basisSummary: scored.sourceEvidence.basis.summary,
    supportingFacts: scored.sourceEvidence.metrics.map((metric) => ({ label: metric.label, value: metric.value })),
    playbook: scored.playbook ? { slug: scored.playbook.slug, title: scored.playbook.title } : null,
    completion: "available",
  };
}

/** Convert a list of scored actions to operator actions (order preserved). */
export function toOperatorActions(list: ScoredAction[]): OperatorAction[] {
  return list.map(toOperatorAction);
}
