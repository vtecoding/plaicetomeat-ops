/**
 * V15.3 — the Morning Briefing Engine.
 * ====================================
 * Give the owner a complete understanding of the day in under 30 seconds — not through a
 * dashboard, but through a short operational briefing read *before* the three actions.
 *
 * It answers exactly one question: "what kind of day am I walking into?" — in three
 * sections (Yesterday / Today / Ignore), ≤100 words total.
 *
 * Hard invariants
 * ---------------
 * - Pure: no I/O, never mutates input. It only *reads* already-trusted V14/V15 signals
 *   (the compressed decisions + the operational morning signal) and chooses words.
 * - Information firewall: it never emits a metric, a confidence value, a ranking, a
 *   percentage or any internal number. The numbers it reads only switch which sentence
 *   it picks (e.g. "was there waste yesterday?" → yes/no), never appear in the output.
 * - It never contradicts Do Now: every reassurance is computed from the *absence* of a
 *   matching action, so it cannot claim "food safety is fine" while a certificate action
 *   is on the list.
 * - The briefing explains; the actions decide. It is always shorter than the actions and
 *   never the dominant surface.
 */
import type { MorningBriefing, MorningSignal, OperatorAction } from "./types";

/** Compliance work routes to the compliance screen; that's how we tell it from an expired-stock fix. */
function isComplianceWork(action: OperatorAction): boolean {
  return action.actionType === "fix" && action.destination === "/admin/compliance";
}

/** Hard ceiling from the spec. Target is 40–80; this is the failure boundary. */
export const BRIEFING_WORD_LIMIT = 100;

function wordsIn(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Section 1 — Yesterday. Calm context from whether the shop traded and whether it wasted. */
function yesterdayLine(morning: MorningSignal): string {
  const traded = morning.revenueYesterday > 0;
  const wasted = morning.wasteYesterday > 0;

  if (!traded) return "Yesterday was quiet — no sales went through.";
  if (wasted) return "Yesterday traded steadily, with a little stock wasted.";
  return "Yesterday was steady, with no waste recorded.";
}

/** A single plain-English lead describing the most important thing waiting today. */
function leadForAction(action: OperatorAction): string {
  const type = action.actionType;
  const item = action.entityLabel;

  switch (type) {
    case "fix":
      if (isComplianceWork(action)) return "A supplier certificate needs attention today.";
      return item ? `${item} needs checking and writing off.` : "Some stock needs checking and writing off.";
    case "sell":
      return item ? `Short-dated ${item} should be sold first.` : "Short-dated stock should be sold first.";
    case "order":
      return item ? `${item} may need ordering soon.` : "Some stock may need ordering soon.";
    case "count":
      return item ? `${item} needs counting to keep stock straight.` : "A few items need counting to keep stock straight.";
    default:
      return "One thing needs a quick look today.";
  }
}

/** Section 2 — Today. The shape of the day, drawn straight from Do Now so it can't contradict it. */
function todayLine(doNow: OperatorAction[]): string {
  if (doNow.length === 0) return "Nothing urgent is waiting — today looks clear so far.";

  const lead = leadForAction(doNow[0]);
  const rest = doNow.length - 1; // Do Now is capped at three, so this is 0, 1 or 2.
  if (rest <= 0) return lead;
  // Spelled, never a digit — the briefing reads as prose, and the list below has the rest.
  return rest === 1 ? `${lead} One more to check below.` : `${lead} A couple more to check below.`;
}

/** Section 3 — Ignore. Reassurance built only from the absence of a matching action. */
function ignoreLine(doNow: OperatorAction[], later: OperatorAction[], morning: MorningSignal): string {
  const all = [...doNow, ...later];
  const reassurances: string[] = [];

  const hasComplianceWork = all.some(isComplianceWork) || morning.certificatesExpiring > 0;
  if (!hasComplianceWork) reassurances.push("Food safety checks are up to date.");

  const hasSellWork = doNow.some((action) => action.actionType === "sell");
  if (morning.expiringBatches === 0 && !hasSellWork) reassurances.push("No stock is about to expire.");

  if (doNow.length === 0) reassurances.push("Nothing urgent needs you this morning.");

  // The Ignore section must always exist — silence makes owners check needlessly.
  if (reassurances.length === 0) return "Everything else can wait — the list below has what matters.";
  return reassurances.slice(0, 2).join(" ");
}

/**
 * Build the three-section morning briefing. Bounded by construction (three short
 * sentences), but we still measure the words so the word-limit invariant is provable and
 * the failure boundary is explicit.
 */
export function buildMorningBriefing(input: {
  doNow: OperatorAction[];
  later: OperatorAction[];
  morning: MorningSignal;
}): MorningBriefing {
  const { doNow, later, morning } = input;

  const yesterday = yesterdayLine(morning);
  const today = todayLine(doNow);
  const ignore = ignoreLine(doNow, later, morning);

  return {
    yesterday,
    today,
    ignore,
    wordCount: wordsIn(yesterday) + wordsIn(today) + wordsIn(ignore),
  };
}
