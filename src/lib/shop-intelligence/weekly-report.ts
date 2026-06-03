/**
 * Management Report (V8.10).
 *
 * An auto-generated weekly summary the owner can glance at: revenue, best and
 * worst performers, biggest waste source, the line most at risk of running out,
 * and compliance status. Every field is honest — null when the data isn't there.
 */
import type { ShopSnapshot } from "./snapshot";
import type { WeeklyReport } from "./types";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function rangeLabel(now: Date): string {
  const start = new Date(now.getTime() - 6 * 86_400_000);
  return `${dateFormatter.format(start)} – ${dateFormatter.format(now)}`;
}

export function buildWeeklyReport(snapshot: ShopSnapshot, now = new Date()): WeeklyReport {
  const topByRevenue = [...snapshot.margin.rows].sort((a, b) => b.revenue - a.revenue)[0] ?? null;
  const topProduct = snapshot.margin.best?.productName ?? topByRevenue?.productName ?? null;
  const lowestProduct =
    snapshot.margin.worst && snapshot.margin.worst.productName !== topProduct ? snapshot.margin.worst.productName : null;
  const biggestWasteSource = snapshot.waste.byProduct[0]?.label ?? null;

  // Most frequent / nearest stock risk: the line with the least cover left.
  const atRisk = snapshot.depletion
    .filter((row) => row.state === "enough_data" && row.daysUntilRunout !== null)
    .sort((a, b) => (a.daysUntilRunout ?? Infinity) - (b.daysUntilRunout ?? Infinity))[0];
  const mostFrequentStockRisk = atRisk?.productName ?? null;

  const complianceSummary =
    snapshot.compliance.rows.length === 0
      ? "No certificates recorded yet."
      : snapshot.compliance.expired > 0
        ? `${snapshot.compliance.expired} certificate(s) expired — act now.`
        : snapshot.compliance.expiringSoon > 0
          ? `${snapshot.compliance.expiringSoon} certificate(s) expiring soon.`
          : "No compliance issues.";

  const notes: string[] = [];
  if (snapshot.margin.unavailableCount > 0) {
    notes.push(
      `Profit figures exclude ${snapshot.margin.unavailableCount} product(s) with no cost — add costs for a complete picture.`,
    );
  }
  if (snapshot.waste.weekValue > 0) {
    notes.push(`About £${snapshot.waste.weekValue.toFixed(2)} of stock was recorded as waste this week.`);
  }
  if (snapshot.revenue.weekToDate === null) {
    notes.push("Weekly revenue isn't shown because order history is still building.");
  }

  return {
    rangeLabel: rangeLabel(now),
    revenue: snapshot.revenue.weekToDate,
    topProduct,
    lowestProduct,
    biggestWasteSource,
    mostFrequentStockRisk,
    complianceSummary,
    notes,
  };
}
