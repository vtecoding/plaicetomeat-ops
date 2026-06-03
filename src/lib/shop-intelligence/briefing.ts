/**
 * Daily Briefing (V8.3 + V8.4).
 *
 * "Every morning the owner should open the app and instantly know what matters."
 * Turns the ranked findings into a short, plain-English narrative — a greeting, a
 * one-line headline, and the few things that actually need attention today.
 */
import type { BriefingItem, DailyBriefing, Finding, IntelSeverity } from "./types";

const ATTENTION: IntelSeverity[] = ["urgent", "warning"];

function greetingFor(now: Date): string {
  const hour = now.getUTCHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

export type BriefingOptions = {
  /** How many lines to show. Dad Mode keeps it short. */
  limit?: number;
  /** Today's order workload, surfaced even when there are no problems. */
  orders?: { awaitingPrep: number; ready: number };
};

/**
 * Build the morning briefing from ranked findings. Only genuine attention items
 * (warning/urgent) are counted as "things to do"; info-level coaching is offered
 * but never inflates the count or alarms the owner.
 */
export function buildDailyBriefing(findings: Finding[], now = new Date(), options: BriefingOptions = {}): DailyBriefing {
  const limit = options.limit ?? 5;
  const greeting = greetingFor(now);

  const attentionFindings = findings.filter((finding) => ATTENTION.includes(finding.severity));
  const shown = attentionFindings.slice(0, limit);
  const items: BriefingItem[] = shown.map((finding) => ({
    id: finding.id,
    text: finding.finding,
    severity: finding.severity,
    area: finding.area,
  }));

  const count = attentionFindings.length;
  const ordersPending = (options.orders?.awaitingPrep ?? 0) + (options.orders?.ready ?? 0);

  let headline: string;
  if (count === 0) {
    headline =
      ordersPending > 0
        ? `Nothing's wrong this morning — just ${ordersPending} order${ordersPending === 1 ? "" : "s"} to work at the counter.`
        : "Nothing needs your attention right now. The shop looks in good shape.";
  } else if (count === 1) {
    headline = "1 thing needs your attention today.";
  } else {
    headline = `${count} things need your attention today.`;
  }

  // The reassurance line gives the owner a clear "where do I stand" close.
  let reassurance: string | null = null;
  if (count === 0) {
    reassurance = "Keep an eye on new orders and carry on.";
  } else if (!shown.some((finding) => finding.severity === "urgent")) {
    reassurance = "None of these are emergencies — work through them when you can.";
  }

  return {
    greeting,
    headline,
    actionCount: count,
    items,
    reassurance,
  };
}
