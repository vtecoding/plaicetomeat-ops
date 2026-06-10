/**
 * V10 — the guided shop day.
 *
 * `buildDayShape` is a pure read over the V9 decision buckets. It answers the first
 * question a first-time owner has each morning: "how much does today ask of me?" — a
 * plain headline, an honest rounded time estimate, and the ordered list of things to
 * walk through. It mutates nothing and performs no I/O.
 *
 * Design note: the guided walk covers Urgent + Important only. Opportunities are
 * "no rush" by definition (V9) and would turn a quick morning check into a chore, so
 * they stay off the walk and remain glanceable on the Today list.
 */
import type { DayShape, OperatorAction } from "./types";

/** Rough per-item minutes — deliberately small and honest, not a promise. */
const MINUTES_PER_STEP = 3;

/** Round to the nearest 5, but never report 0 minutes for real work. */
function roundMinutes(raw: number): number {
  if (raw <= 0) return 0;
  return Math.max(5, Math.round(raw / 5) * 5);
}

function timePhrase(minutes: number): string | null {
  if (minutes <= 0) return null;
  if (minutes <= 5) return "a few minutes";
  return `about ${minutes} minutes`;
}

/**
 * V15.4 — works on the operator-safe action list (no scored buckets). The estimate is an
 * honest flat per-item figure; it never reads a priority or score.
 */
export function buildDayShape(steps: OperatorAction[]): DayShape {
  const needsYouCount = steps.length;
  const allClear = needsYouCount === 0;

  const estimateMinutes = roundMinutes(needsYouCount * MINUTES_PER_STEP);
  const timeLabel = timePhrase(estimateMinutes);

  const headline = allClear
    ? "Nothing needs you — you're clear to trade."
    : `${needsYouCount} ${needsYouCount === 1 ? "thing needs" : "things need"} you today — ${timeLabel}.`;

  return { allClear, needsYouCount, steps, estimateMinutes, timeLabel, headline };
}
