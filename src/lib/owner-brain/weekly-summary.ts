/**
 * V9 — the weekly owner summary.
 *
 * One page, three of each: wins, risks, opportunities. Plain English, no charts. Reuses
 * the V8 weekly report for the positives and the already-ranked decisions for the risks
 * and opportunities, so it never contradicts what the rest of the screen says.
 */
import type { ShopIntelligence } from "@/lib/shop-intelligence/types";
import { deJargon } from "./language";
import type { OwnerDecision, OwnerWeeklySummary } from "./types";

const MAX = 3;

export function buildOwnerWeeklySummary(
  intel: ShopIntelligence,
  buckets: { urgent: OwnerDecision[]; important: OwnerDecision[]; opportunities: OwnerDecision[] },
): OwnerWeeklySummary {
  const weekly = intel.weekly;

  const wins: string[] = [];
  if (weekly.topProduct) wins.push(`${weekly.topProduct} is selling well.`);
  if (weekly.complianceSummary === "No compliance issues.") wins.push("No halal or food-safety problems this week.");
  if (typeof weekly.revenue === "number" && weekly.revenue > 0) {
    wins.push(`£${Math.round(weekly.revenue).toLocaleString("en-GB")} taken so far this week.`);
  }
  if (intel.health.strong.length > 0) wins.push(`${deJargon(intel.health.strong[0])} is in good shape.`);

  // Risks: the most pressing real problems, urgent before important.
  const risks = [...buckets.urgent, ...buckets.important]
    .slice(0, MAX)
    .map((decision) => `${decision.title} — ${decision.estimatedImpact.label.toLowerCase()}.`);
  if (weekly.mostFrequentStockRisk && risks.length < MAX) {
    risks.push(`${weekly.mostFrequentStockRisk} is the line most likely to run out.`);
  }

  const opportunities = buckets.opportunities.slice(0, MAX).map((decision) => decision.title);
  if (weekly.biggestWasteSource && opportunities.length < MAX) {
    opportunities.push(`Cutting waste on ${weekly.biggestWasteSource} would lift profit.`);
  }

  return {
    rangeLabel: weekly.rangeLabel,
    wins: dedupe(wins).slice(0, MAX),
    risks: dedupe(risks).slice(0, MAX),
    opportunities: dedupe(opportunities).slice(0, MAX),
  };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
