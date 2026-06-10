/**
 * V9 — turning V8 findings into owner decisions.
 *
 * Each `Finding` becomes one `OwnerDecision`: the same underlying intelligence, recast as
 * a business decision with a money impact, an owner, a due window and plain language.
 * Pure, no I/O.
 */
import type { Finding, IntelArea, IntelSeverity } from "@/lib/shop-intelligence/types";
import { deJargon } from "./language";
import { estimateMoneyImpact, isUpsideFinding, moneyMagnitude } from "./money";
import type { DecisionCategory, DueWindow, OwnerDecision } from "./types";

/** Who normally acts on each kind of issue (generic role labels, never names). */
const AREA_OWNER: Record<IntelArea, string> = {
  stock: "You / Owner",
  expiry: "You / Owner",
  waste: "You / Owner",
  margin: "You / Owner",
  compliance: "You / Owner",
  yield: "You / Owner",
  consistency: "You / Owner",
  discipline: "You / Owner",
  orders: "Counter team",
  system: "Counter team",
};

const SEVERITY_PRIORITY: Record<IntelSeverity, number> = { urgent: 300, warning: 200, info: 100 };
const CONFIDENCE_PRIORITY = { high: 20, medium: 10, low: 0 } as const;

/** Which of the three buckets a finding belongs in. */
export function categorise(finding: Finding): DecisionCategory {
  if (finding.severity === "urgent") return "urgent";
  if (finding.severity === "warning") return "important";
  // info-level: good news is an opportunity; everything else is a low-priority tidy-up.
  return isUpsideFinding(finding) ? "opportunity" : "important";
}

function dueWindowFor(category: DecisionCategory): DueWindow {
  if (category === "urgent") return "today";
  if (category === "important") return "this_week";
  return "when_you_can";
}

/** Map a V8 finding onto the V9 decision schema, stripping any jargon on the way. */
export function toOwnerDecision(finding: Finding): OwnerDecision {
  const category = categorise(finding);
  const estimatedImpact = estimateMoneyImpact(finding);
  const priority =
    SEVERITY_PRIORITY[finding.severity] +
    CONFIDENCE_PRIORITY[finding.confidence] +
    Math.min(60, Math.round(moneyMagnitude(estimatedImpact) / 10));

  return {
    id: finding.id,
    category,
    area: finding.area,
    priority,
    title: deJargon(finding.finding),
    whatHappened: deJargon(finding.explanation),
    whyItMatters: deJargon(finding.consequence),
    recommendedAction: deJargon(finding.recommendedAction),
    estimatedImpact,
    owner: AREA_OWNER[finding.area],
    dueWindow: dueWindowFor(category),
    sourceEvidence: {
      basis: finding.basis,
      metrics: finding.metrics.map((metric) => ({ label: deJargon(metric.label), value: metric.value })),
    },
    playbook: finding.playbook,
  };
}

/** Most pressing first: money at stake, then how sure we are, then a stable tie-break. */
export function rankDecisions(decisions: OwnerDecision[]): OwnerDecision[] {
  return [...decisions].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const money = moneyMagnitude(b.estimatedImpact) - moneyMagnitude(a.estimatedImpact);
    if (money !== 0) return money;
    return a.title.localeCompare(b.title);
  });
}
