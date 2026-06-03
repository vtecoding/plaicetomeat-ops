/**
 * Operational Health Score (V8.8).
 *
 * "Not gamification — actual business health." Six categories, each scored only
 * when there's enough data to be honest (otherwise `unknown`, never a fake number).
 * The overall score is the average of the categories we can actually judge.
 */
import type { ShopSnapshot } from "./snapshot";
import type { HealthCategory, HealthScore } from "./types";

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bandFor(score: number): HealthCategory["band"] {
  if (score >= 80) return "strong";
  if (score >= 60) return "fair";
  return "needs_attention";
}

type Partial = { score: number | null; detail: string };

function stockAccuracy(snapshot: ShopSnapshot): Partial {
  if (snapshot.stock.activeBatchCount === 0) {
    return { score: null, detail: "No active stock recorded yet." };
  }
  let score = 100;
  const idle = snapshot.stock.daysSinceLastStockActivity;
  if (idle !== null && idle > 7) score -= Math.min(40, (idle - 7) * 2);

  const ghost = snapshot.batches.filter((b) => b.status !== "active" && b.remainingWeightKg > 0.01).length;
  const expiredActive = snapshot.batches.filter((b) => b.status === "active" && b.remainingWeightKg > 0.01 && b.daysToExpiry < 0).length;
  if (ghost > 0) score -= 20;
  if (expiredActive > 0) score -= 25;

  const detail =
    ghost > 0 || expiredActive > 0
      ? "Some records disagree with the fridge — a recount would help."
      : idle !== null && idle > 14
        ? `No stock activity for ${idle} days.`
        : "Records look current and consistent.";
  return { score: clamp(score), detail };
}

function costCoverage(snapshot: ShopSnapshot): Partial {
  if (snapshot.products.total === 0) return { score: null, detail: "No products added yet." };
  const covered = snapshot.products.total - snapshot.products.missingCost;
  const score = (covered / snapshot.products.total) * 100;
  return {
    score: clamp(score),
    detail:
      snapshot.products.missingCost === 0
        ? "Every product has a cost — profit can be worked out."
        : `${snapshot.products.missingCost} of ${snapshot.products.total} products still need a cost.`,
  };
}

function complianceReadiness(snapshot: ShopSnapshot): Partial {
  if (snapshot.compliance.rows.length === 0) {
    return { score: null, detail: "No supplier certificates recorded yet." };
  }
  let score = 100;
  score -= snapshot.compliance.expired * 40;
  score -= snapshot.compliance.expiringSoon * 15;
  score -= snapshot.compliance.missing * 12;
  const detail =
    snapshot.compliance.expired > 0
      ? `${snapshot.compliance.expired} certificate(s) expired.`
      : snapshot.compliance.expiringSoon > 0
        ? `${snapshot.compliance.expiringSoon} certificate(s) expiring soon.`
        : "Certificates recorded and in date.";
  return { score: clamp(score), detail };
}

function purchasingDiscipline(snapshot: ShopSnapshot): Partial {
  if (snapshot.products.total === 0) return { score: null, detail: "Add products to plan purchasing." };
  let score = snapshot.purchasing.dataQualityScore;
  if (snapshot.purchasing.supplierReadiness === "needs_review") score -= 10;
  return {
    score: clamp(score),
    detail:
      snapshot.purchasing.dataQualityBand === "high"
        ? "Strong data behind ordering decisions."
        : `Buying data is ${snapshot.purchasing.dataQualityBand} quality — fill gaps for better advice.`,
  };
}

function wasteTracking(snapshot: ShopSnapshot): Partial {
  if (snapshot.stock.activeBatchCount === 0) return { score: null, detail: "No stock to track waste against yet." };
  const events = snapshot.waste.eventsThisWeek;
  const score = events >= 3 ? 100 : events >= 1 ? 75 : 40;
  return {
    score,
    detail:
      events >= 1
        ? `${events} waste record(s) this week — good habit.`
        : "No waste logged this week. Logging it shows where money goes.",
  };
}

function orderFlow(snapshot: ShopSnapshot): Partial {
  if (snapshot.orders.today === 0) return { score: null, detail: "No orders today yet." };
  let score = 100;
  if (snapshot.system.failedSmsToday > 0) score -= Math.min(30, snapshot.system.failedSmsToday * 10);
  return {
    score: clamp(score),
    detail:
      snapshot.system.failedSmsToday > 0
        ? `${snapshot.orders.today} orders today; ${snapshot.system.failedSmsToday} text(s) failed.`
        : `${snapshot.orders.today} orders flowing through the counter.`,
  };
}

export function buildHealthScore(snapshot: ShopSnapshot): HealthScore {
  const specs: Array<{ key: HealthCategory["key"]; label: string; part: Partial }> = [
    { key: "stock_accuracy", label: "Stock accuracy", part: stockAccuracy(snapshot) },
    { key: "cost_coverage", label: "Cost coverage", part: costCoverage(snapshot) },
    { key: "compliance_readiness", label: "Compliance readiness", part: complianceReadiness(snapshot) },
    { key: "purchasing_discipline", label: "Buying decisions", part: purchasingDiscipline(snapshot) },
    { key: "waste_tracking", label: "Waste tracking", part: wasteTracking(snapshot) },
    { key: "order_flow", label: "Order handling", part: orderFlow(snapshot) },
  ];

  const categories: HealthCategory[] = specs.map(({ key, label, part }) => ({
    key,
    label,
    score: part.score ?? 0,
    band: part.score === null ? "unknown" : bandFor(part.score),
    detail: part.detail,
  }));

  const known = categories.filter((category) => category.band !== "unknown");
  const score = known.length === 0 ? null : clamp(known.reduce((sum, category) => sum + category.score, 0) / known.length);
  const band = score === null ? "unknown" : bandFor(score);

  return {
    score,
    band,
    categories,
    strong: known.filter((category) => category.band === "strong").map((category) => category.label),
    needsAttention: known.filter((category) => category.band === "needs_attention").map((category) => category.label),
  };
}
