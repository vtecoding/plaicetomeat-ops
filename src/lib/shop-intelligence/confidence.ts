/**
 * Data Confidence System (V8.7).
 *
 * "Never pretend weak data is strong." Confidence is *derived from how much real
 * evidence exists*, and every finding can state plainly what it is based on.
 */
import { CONFIDENCE_RANK, type DataBasis, type IntelConfidence } from "./types";

/** Clamp a base confidence so it can never exceed what the evidence supports. */
export function capConfidence(base: IntelConfidence, cap: IntelConfidence): IntelConfidence {
  return CONFIDENCE_RANK[base] <= CONFIDENCE_RANK[cap] ? base : cap;
}

/** The weaker (lower) of two confidence levels. */
export function minConfidence(a: IntelConfidence, b: IntelConfidence): IntelConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export type EvidencePoint = {
  /** What kind of evidence, e.g. "intakes", "weeks of sales", "purchases". */
  label: string;
  /** How many of it we have. */
  count: number;
  /** Counts at/above this are "high"; at/above `mediumAt` are "medium". */
  highAt: number;
  mediumAt: number;
};

function levelFor(point: EvidencePoint): IntelConfidence {
  if (point.count >= point.highAt) return "high";
  if (point.count >= point.mediumAt) return "medium";
  return "low";
}

/**
 * Build a `DataBasis` from concrete evidence points. The overall confidence is the
 * *weakest* of the points (a single thin signal drags the whole thing down — that
 * is the honest behaviour), and the summary names the most important evidence.
 */
export function buildBasis(points: EvidencePoint[], context?: string): DataBasis {
  if (points.length === 0) {
    return {
      confidence: "low",
      summary: context ? `Early signal — ${context}` : "Early signal — not much data yet",
      points: [],
    };
  }

  const confidence = points.map(levelFor).reduce<IntelConfidence>((weakest, level) => minConfidence(weakest, level), "high");
  const detailLines = points.map((point) => `${point.count} ${point.label}`);
  const lead = detailLines[0];

  return {
    confidence,
    summary: context ? `Based on ${lead} (${context})` : `Based on ${lead}`,
    points: detailLines,
  };
}

/**
 * Roll up the most relevant per-area bases into one top-line confidence statement
 * for the whole briefing (V8.7 — the "High / Low Confidence" banner).
 */
export function summariseConfidence(bases: DataBasis[]): DataBasis {
  if (bases.length === 0) {
    return {
      confidence: "low",
      summary: "Not enough data yet — keep recording stock, sales and intakes.",
      points: [],
    };
  }

  const confidence = bases
    .map((basis) => basis.confidence)
    .reduce<IntelConfidence>((weakest, level) => minConfidence(weakest, level), "high");

  // Merge the evidence points, keeping the strongest example of each phrasing.
  const points = Array.from(new Set(bases.flatMap((basis) => basis.points))).slice(0, 4);

  const summary =
    confidence === "high"
      ? "Strong picture — recommendations are well-supported by your data."
      : confidence === "medium"
        ? "Reasonable picture — a few areas still need more history."
        : "Early days — treat suggestions as a starting point, not gospel.";

  return { confidence, summary, points };
}
