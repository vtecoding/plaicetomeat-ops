/**
 * Finding builders (V8.1, V8.2, V8.4, V8.5, V8.11, V8.12).
 *
 * Each builder turns a slice of the snapshot into explain-everything `Finding`s.
 * Pure, no I/O. The engine (`engine.ts`) merges and ranks them.
 *
 * Honesty rules throughout: if the evidence isn't there, no finding is produced;
 * confidence is derived from real data volume; nothing here mutates anything.
 */
import type { OwnerAction } from "@/lib/action-intelligence/action-types";
import { buildBasis } from "./confidence";
import { playbookForArea } from "./playbooks";
import type { ShopSnapshot, SnapshotBatch } from "./snapshot";
import type { Finding, IntelArea, IntelConfidence, IntelSeverity } from "./types";

// --- formatting helpers ----------------------------------------------------

function kg(value: number): string {
  return `${Math.round(value * 10) / 10}kg`;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// --- 1. normalise existing OwnerActions (reuse the proven engine) ----------

const CATEGORY_AREA: Record<OwnerAction["category"], IntelArea> = {
  stock: "stock",
  waste: "waste",
  margin: "margin",
  compliance: "compliance",
  customer: "orders",
  basket: "orders",
  system: "system",
};

function basisFromActionConfidence(confidence: IntelConfidence) {
  const summary =
    confidence === "high"
      ? "Based on confirmed shop records"
      : confidence === "medium"
        ? "Based on recent shop activity"
        : "Early signal from limited data";
  return { confidence, summary, points: [] as string[] };
}

/**
 * Upgrade each `OwnerAction` to the V8 `Finding` contract: its `estimatedImpact`
 * becomes the explicit *consequence* (V8.4), and it gains a confidence basis and a
 * playbook link.
 */
export function findingsFromOwnerActions(actions: OwnerAction[]): Finding[] {
  return actions.map((action) => {
    const area = CATEGORY_AREA[action.category];
    return {
      id: `action-${action.id}`,
      area,
      finding: action.title,
      severity: action.severity,
      explanation: action.explanation,
      consequence: action.estimatedImpact,
      recommendedAction: action.recommendedAction,
      confidence: action.confidence,
      basis: basisFromActionConfidence(action.confidence),
      playbook: playbookForArea(area),
      metrics: Object.entries(action.sourceMetrics)
        .filter(([, value]) => value !== null && value !== "")
        .slice(0, 4)
        .map(([label, value]) => ({ label: humaniseKey(label), value: String(value) })),
      source: "owner-action" as const,
    };
  });
}

function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// --- 2. Reality Learning / Business Memory (V8.2 + V8.11) ------------------

export type YieldRealityOptions = {
  /** Minimum confirmed intakes before we'll say anything at all. */
  minIntakes?: number;
  /** Average variance (as a fraction of expected) past which we flag. */
  flagFraction?: number;
};

type ProductYield = {
  productName: string;
  intakes: number;
  belowCount: number;
  aboveCount: number;
  totalExpected: number;
  totalActual: number;
};

/**
 * The crown jewel: learn from how a whole animal *actually* breaks down versus the
 * cut-sheet estimate, across many intakes. Reads the expected/actual weights that
 * land on every confirmed inventory batch (V6.6) — no new data needed.
 */
export function buildYieldReality(batches: SnapshotBatch[], options: YieldRealityOptions = {}): Finding[] {
  const minIntakes = options.minIntakes ?? 2;
  const flagFraction = options.flagFraction ?? 0.05;

  const byProduct = new Map<string, ProductYield>();
  for (const batch of batches) {
    // Only confirmed intakes with a real expectation are evidence.
    if (!batch.actualConfirmedAt || batch.expectedWeightKg <= 0) continue;
    const entry =
      byProduct.get(batch.productName) ??
      ({ productName: batch.productName, intakes: 0, belowCount: 0, aboveCount: 0, totalExpected: 0, totalActual: 0 } satisfies ProductYield);
    entry.intakes += 1;
    entry.totalExpected += batch.expectedWeightKg;
    entry.totalActual += batch.actualWeightKg;
    if (batch.varianceKg < 0) entry.belowCount += 1;
    if (batch.varianceKg > 0) entry.aboveCount += 1;
    byProduct.set(batch.productName, entry);
  }

  const findings: Finding[] = [];
  for (const entry of byProduct.values()) {
    if (entry.intakes < minIntakes || entry.totalExpected <= 0) continue;

    const avgVarianceFraction = (entry.totalActual - entry.totalExpected) / entry.totalExpected;
    const avgVariancePct = avgVarianceFraction * 100;
    const basis = buildBasis(
      [{ label: plural(entry.intakes, "confirmed intake", "confirmed intakes"), count: entry.intakes, highAt: 6, mediumAt: 3 }],
      "expected vs actual weights",
    );
    const metrics = [
      { label: "Intakes compared", value: String(entry.intakes) },
      { label: "Avg expected", value: kg(entry.totalExpected / entry.intakes) },
      { label: "Avg actual", value: kg(entry.totalActual / entry.intakes) },
      { label: "Average difference", value: `${avgVariancePct >= 0 ? "+" : ""}${pct(avgVariancePct)}` },
    ];

    // Consistently UNDER estimate — the dangerous one (over-pricing / thin margins).
    if (avgVarianceFraction <= -flagFraction && entry.belowCount >= entry.aboveCount) {
      findings.push({
        id: `yield-under-${slug(entry.productName)}`,
        area: "yield",
        finding: `${entry.productName} keeps yielding less than expected`,
        severity: avgVarianceFraction <= -0.12 ? "warning" : "info",
        explanation: `Across the last ${entry.intakes} confirmed intakes, ${entry.productName} gave about ${pct(Math.abs(avgVariancePct))} less saleable meat than the cutting guide assumed — that's the weight left after bone, fat and trim are taken off.`,
        consequence:
          "Your suggested prices are worked out from the higher yield, so each kilo is really costing you more than the figures show. Left unchecked, you'd be quietly selling this cut too cheaply.",
        recommendedAction:
          "Two things to check: are you trimming more fat or bone off than the guide expects, or is the guide's estimate simply high for your supplier's animals? Review trimming and boning, or lower the expected yield so the price reflects what you actually get. Owner decides — nothing changes automatically.",
        confidence: basis.confidence,
        basis,
        playbook: playbookForArea("yield"),
        metrics,
        source: "engine",
      });
      continue;
    }

    // Consistently OVER estimate — an opportunity, not a risk.
    if (avgVarianceFraction >= flagFraction && entry.aboveCount >= entry.belowCount) {
      findings.push({
        id: `yield-over-${slug(entry.productName)}`,
        area: "yield",
        finding: `${entry.productName} yields more than expected`,
        severity: "info",
        explanation: `Across the last ${entry.intakes} confirmed intakes, ${entry.productName} gave about ${pct(avgVariancePct)} more saleable meat than the cutting guide assumed — good cutting, or good animals from your supplier.`,
        consequence: "Your real cost per kilo is a little lower than the figures show, so there's room to either price more keenly than rivals or simply enjoy the extra margin.",
        recommendedAction: "Consider raising the expected yield so the figures match what you really get. Owner decides.",
        confidence: basis.confidence,
        basis,
        playbook: playbookForArea("yield"),
        metrics,
        source: "engine",
      });
    }
  }

  return findings;
}

// --- 3. Cross-System Consistency Monitor (V8.12) ---------------------------

/** Flag numbers that contradict each other across subsystems. */
export function buildConsistencyChecks(snapshot: ShopSnapshot): Finding[] {
  const findings: Finding[] = [];
  const confirmedBasis = buildBasis([{ label: "direct record check", count: 1, highAt: 1, mediumAt: 1 }]);

  // (a) Stock marked gone but weight still on the books.
  const ghostStock = snapshot.batches.filter((b) => b.status !== "active" && b.remainingWeightKg > 0.01);
  if (ghostStock.length > 0) {
    const totalKg = ghostStock.reduce((sum, b) => sum + b.remainingWeightKg, 0);
    findings.push({
      id: "consistency-ghost-stock",
      area: "consistency",
      finding: "Stock is marked as gone but still shows weight left",
      severity: "warning",
      explanation: `${ghostStock.length} ${plural(ghostStock.length, "batch", "batches")} (${kg(totalKg)}) ${plural(ghostStock.length, "is", "are")} marked depleted/disposed but still ${plural(ghostStock.length, "has", "have")} weight recorded.`,
      consequence: "Stock cover, value-at-risk and 'what to order' figures will be wrong while the records disagree with the fridge.",
      recommendedAction: "Recount these batches and either set the remaining weight to zero or mark them active again — whichever is true.",
      confidence: confirmedBasis.confidence,
      basis: confirmedBasis,
      playbook: playbookForArea("consistency"),
      metrics: [
        { label: "Batches", value: String(ghostStock.length) },
        { label: "Weight shown", value: kg(totalKg) },
      ],
      source: "engine",
    });
  }

  // (b) Past use-by but still counted as sellable.
  const expiredActive = snapshot.batches.filter((b) => b.status === "active" && b.remainingWeightKg > 0.01 && b.daysToExpiry < 0);
  if (expiredActive.length > 0) {
    const totalKg = expiredActive.reduce((sum, b) => sum + b.remainingWeightKg, 0);
    findings.push({
      id: "consistency-expired-active",
      area: "consistency",
      finding: "Out-of-date stock is still counted as good",
      severity: "urgent",
      explanation: `${expiredActive.length} active ${plural(expiredActive.length, "batch is", "batches are")} past the use-by date (${kg(totalKg)}) but still marked sellable.`,
      consequence: "Out-of-date meat could be sold or counted as good stock — a food-safety and halal-trust risk, and it inflates your stock value.",
      recommendedAction: "Pull these batches now: record them as waste/disposed so they leave sellable stock immediately.",
      confidence: confirmedBasis.confidence,
      basis: confirmedBasis,
      playbook: playbookForArea("expiry"),
      metrics: [
        { label: "Batches", value: String(expiredActive.length) },
        { label: "Weight", value: kg(totalKg) },
      ],
      source: "engine",
    });
  }

  // (c) Selling but no cost — profit can't be shown.
  if (snapshot.products.activeSellingNoCost > 0) {
    const n = snapshot.products.activeSellingNoCost;
    findings.push({
      id: "consistency-selling-no-cost",
      area: "consistency",
      finding: "Products are selling with no cost recorded",
      severity: "warning",
      explanation: `${n} ${plural(n, "product is", "products are")} selling but ${plural(n, "has", "have")} no cost price, so the shop can't work out their profit.`,
      consequence: "'What's making money' and your profit figures stay blank for these lines — you could be selling them at a loss without knowing.",
      recommendedAction: "Add a cost to each one (Products & Prices, or via a carcass intake). Owner decides the figure.",
      confidence: confirmedBasis.confidence,
      basis: confirmedBasis,
      playbook: playbookForArea("margin"),
      metrics: [{ label: "Products", value: String(n) }],
      source: "engine",
    });
  }

  return findings;
}

// --- 4. Operational Coach (V8.5) — process & habit nudges ------------------

/** Gentle, info-level coaching about keeping records honest and useful. */
export function buildCoachNudges(snapshot: ShopSnapshot): Finding[] {
  const findings: Finding[] = [];

  // Stock-accuracy cadence.
  const idleDays = snapshot.stock.daysSinceLastStockActivity;
  if (idleDays !== null && idleDays >= 14 && snapshot.stock.activeBatchCount > 0) {
    const basis = buildBasis([{ label: "days since last stock record", count: idleDays, highAt: 14, mediumAt: 7 }]);
    findings.push({
      id: "coach-stock-accuracy",
      area: "discipline",
      finding: "Stock hasn't been touched in a while",
      severity: "info",
      explanation: `No new stock or stock correction has been recorded for ${idleDays} days.`,
      consequence: "Recorded stock slowly drifts from what's really in the fridge, which makes every stock and ordering figure less reliable.",
      recommendedAction: "Do a quick count of your main lines and correct anything that's off. Ten minutes keeps the numbers trustworthy.",
      confidence: basis.confidence,
      basis,
      playbook: playbookForArea("discipline"),
      metrics: [{ label: "Days idle", value: String(idleDays) }],
      source: "engine",
    });
  }

  // Waste-logging habit.
  if (snapshot.waste.eventsThisWeek === 0 && snapshot.stock.activeBatchCount > 0) {
    const basis = buildBasis([], "no waste recorded this week");
    findings.push({
      id: "coach-waste-logging",
      area: "discipline",
      finding: "No waste logged this week",
      severity: "info",
      explanation: "Nothing has been recorded as waste in the last 7 days.",
      consequence: "If anything was thrown away but not logged, the shop can't show you where money is being lost — waste advice stays blank.",
      recommendedAction: "Jot down trim, spoilage and customer returns as they happen. If you genuinely wasted nothing, that's great — no action needed.",
      confidence: basis.confidence,
      basis,
      playbook: playbookForArea("waste"),
      metrics: [],
      source: "engine",
    });
  }

  // Cost-coverage habit.
  if (snapshot.products.missingCost > 0) {
    const n = snapshot.products.missingCost;
    const basis = buildBasis([{ label: "products without a cost", count: n, highAt: 1, mediumAt: 1 }]);
    findings.push({
      id: "coach-cost-coverage",
      area: "discipline",
      finding: "Some products still have no cost",
      severity: "info",
      explanation: `${n} ${plural(n, "product has", "products have")} no cost price recorded.`,
      consequence: "Until every product has a cost, profit and margin figures are incomplete and 'what's making money' can't include them.",
      recommendedAction: "Add costs a few at a time — start with your best sellers so the profit picture fills in fastest.",
      confidence: basis.confidence,
      basis,
      playbook: playbookForArea("margin"),
      metrics: [{ label: "Missing costs", value: String(n) }],
      source: "engine",
    });
  }

  return findings;
}

// --- ranking ---------------------------------------------------------------

const SEVERITY_RANK: Record<IntelSeverity, number> = { urgent: 3, warning: 2, info: 1 };
const CONFIDENCE_RANK: Record<IntelConfidence, number> = { high: 2, medium: 1, low: 0 };

/** Most urgent first; ties broken by confidence then headline for stability. */
export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    const conf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (conf !== 0) return conf;
    return a.finding.localeCompare(b.finding);
  });
}
