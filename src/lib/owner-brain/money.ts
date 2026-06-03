/**
 * V9 — money impact.
 *
 * "How much money is involved?" is one of the four questions every decision must answer.
 * This turns a V8 `Finding` into a `MoneyImpact`, reading the structured numbers the
 * finding already carries (its metrics) plus its text. It never fabricates a figure: when
 * the data can't price something honestly, it returns a qualitative `none` impact whose
 * label explains the value in words instead.
 */
import type { Finding, IntelArea } from "@/lib/shop-intelligence/types";
import type { MoneyImpact } from "./types";

const CURRENCY_RE = /£\s*([\d,]+(?:\.\d+)?)/;
const WEIGHT_RE = /([\d.]+)\s*kg\b/i;

/** First £ amount mentioned across a finding's metrics and text, or null. */
function firstCurrency(finding: Finding): number | null {
  const haystacks = [
    ...finding.metrics.map((metric) => metric.value),
    finding.consequence,
    finding.explanation,
    finding.finding,
  ];
  for (const text of haystacks) {
    const match = CURRENCY_RE.exec(text);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

/** First weight in kg mentioned across a finding's metrics, or null. */
function firstWeightKg(finding: Finding): number | null {
  for (const metric of finding.metrics) {
    const match = WEIGHT_RE.exec(metric.value);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function gbp(value: number): string {
  const rounded = Math.round(value);
  return `£${rounded.toLocaleString("en-GB")}`;
}

/** Areas where the value is real but genuinely can't be priced in pounds yet. */
const QUALITATIVE: Partial<Record<IntelArea, { kind: MoneyImpact["kind"]; label: string }>> = {
  compliance: { kind: "risk", label: "Could stop you selling that meat — and risks customer trust" },
  yield: { kind: "loss", label: "You may be pricing too low — check before it eats your profit" },
  margin: { kind: "loss", label: "Some lines may be selling at a loss until costs are added" },
  discipline: { kind: "none", label: "Keeps your figures trustworthy" },
};

/**
 * Estimate the money at stake behind a finding. Priority:
 *  1. a real £ figure the finding already carries → loss (waste) or risk (everything else),
 *  2. a weight at risk we can describe but not price → qualitative,
 *  3. an area-specific qualitative value,
 *  4. honest fallback: "Hard to put a figure on yet".
 */
export function estimateMoneyImpact(finding: Finding): MoneyImpact {
  const isOpportunity = isUpsideFinding(finding);
  const money = firstCurrency(finding);

  if (money !== null) {
    if (isOpportunity) {
      return { kind: "opportunity", oneOff: money, label: `About ${gbp(money)} of extra value to chase` };
    }
    if (finding.area === "waste") {
      return { kind: "loss", weeklyLow: money, weeklyHigh: money, label: `About ${gbp(money)} a week` };
    }
    return { kind: "risk", oneOff: money, label: `${gbp(money)} at stake right now` };
  }

  const weight = firstWeightKg(finding);
  if (weight !== null && (finding.area === "expiry" || finding.area === "consistency" || finding.area === "stock")) {
    return { kind: "risk", label: `About ${weight}kg of stock at stake` };
  }

  if (isOpportunity) {
    return { kind: "opportunity", label: "A chance to sell more — worth a look" };
  }

  const qualitative = QUALITATIVE[finding.area];
  if (qualitative) return { kind: qualitative.kind, label: qualitative.label };

  return { kind: "none", label: "Hard to put a figure on yet" };
}

/** A finding that's good news (an opportunity), not a problem. */
export function isUpsideFinding(finding: Finding): boolean {
  if (finding.id.startsWith("yield-over-")) return true;
  if (finding.area === "orders" && finding.severity === "info") return true;
  return false;
}

/**
 * A single comparable magnitude for ranking decisions by money. Real pounds win; a
 * qualitative risk/loss still outranks "no figure". Opportunities never outrank problems.
 */
export function moneyMagnitude(impact: MoneyImpact): number {
  if (impact.weeklyHigh !== undefined) return impact.weeklyHigh * 4; // ~a month of recurring loss
  if (impact.oneOff !== undefined) return impact.oneOff;
  if (impact.kind === "risk" || impact.kind === "loss") return 1; // priced-in-words, still a problem
  return 0;
}

/** Owner-facing one-liner for a money impact. */
export function formatMoneyImpact(impact: MoneyImpact): string {
  return impact.label;
}
