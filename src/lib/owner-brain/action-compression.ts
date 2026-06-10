/**
 * V15 — Action Compression Engine.
 * ================================
 * The system already knows what matters (V14 produced truthful, butcher-safe,
 * confidence-routed guidance). V15 chooses what matters *most*: it does not invent
 * advice, it only ranks and compresses the already-certified V9 `OwnerDecision`s into
 * the three the butcher should do now — everything else goes to a "Later" reserve.
 *
 * Required invariant
 * ------------------
 * This engine NEVER creates a recommendation, NEVER rewrites one (a low-confidence
 * "Count" can never become a "Sell"/"Order" — it only re-orders the objects it is given),
 * and NEVER mutates its input.
 *
 * Doctrine ranking (the heart of it)
 * ----------------------------------
 * Actions compete in one global field, ranked by doctrine tier — NOT by the visual
 * Urgent/Important/Opportunity category they happened to arrive in:
 *
 *     1. prevent_loss      money already leaving the till; can't-sell compliance
 *     2. prevent_waste     short-dated stock we can still save by selling first
 *     3. prevent_stockout  running out — order before the shelf is empty
 *     4. protect_sales     keep the day's trade healthy
 *     5. reduce_work       counting / hygiene that saves future work and error
 *     6. improve_profit    buy-less, opportunities, margin upside — never urgent
 *
 * The butcher must NEVER see a score, a rank, a doctrine value or a confidence weight.
 * Those live only in `ActionEvidence`, for tests / audit / debugging.
 */
import { moneyMagnitude } from "./money";
import type { ActionEvidence, DoctrineTier, OwnerDecision } from "./types";

/** The butcher sees three things to do now. No path may ever surface a fourth. */
export const DO_NOW_MAX = 3;

/** Higher rank = more important. Drives the single global contest. */
export const DOCTRINE_RANK: Record<DoctrineTier, number> = {
  prevent_loss: 6,
  prevent_waste: 5,
  prevent_stockout: 4,
  protect_sales: 3,
  reduce_work: 2,
  improve_profit: 1,
};

/** Urgency only ever breaks a doctrine+money tie — it never outranks the doctrine. */
const URGENCY_RANK: Record<OwnerDecision["category"], number> = {
  urgent: 3,
  important: 2,
  opportunity: 1,
};

/**
 * Classify one decision into a doctrine tier. Reads the structured signal the decision
 * already carries — its `area`, its money `kind`, and the verb its plain-English
 * recommended action opens with (Count… / Order… / Sell… / record waste). It never reads
 * a confidence number and never changes the action.
 */
export function classifyDoctrine(decision: OwnerDecision): DoctrineTier {
  const area = decision.area;
  const action = (decision.recommendedAction ?? "").toLowerCase();
  const id = decision.id ?? "";
  const money = decision.estimatedImpact.kind;

  // 1. Food safety / halal — losing the right to sell the meat is the gravest loss.
  if (area === "compliance") return "prevent_loss";

  // 2. Money already walking out of the till: waste being recorded, expired stock,
  //    or lines that price out as a straight loss (margin / yield).
  if (/record waste|no longer be sellable/.test(action)) return "prevent_loss";
  if (area === "waste") return "prevent_loss";
  if (money === "loss") return "prevent_loss";

  // 3. Stock we can still save by selling it first (short-dated, not yet wasted).
  if (/^sell\b/.test(action) || id.startsWith("operator-sell-first")) return "prevent_waste";
  if (area === "expiry") return "prevent_waste";

  // 4. Running out — order more before the shelf is empty. ("Order less" is profit, below.)
  const orderLess = /order less/.test(action) || id.startsWith("operator-order-less");
  if (!orderLess && (/^order\b/.test(action) || id.startsWith("operator-order-"))) return "prevent_stockout";

  // 5. Counting keeps the truth straight — operational hygiene that saves future work.
  if (/^count\b/.test(action) || /please count/.test(action) || id.startsWith("operator-count")) return "reduce_work";

  // 6. Buy-less, opportunities and margin upside — real, but never urgent.
  if (orderLess) return "improve_profit";
  if (money === "opportunity" || decision.category === "opportunity") return "improve_profit";
  if (area === "margin" || area === "yield") return "improve_profit";

  // Default — a plain "keep trading healthy" action.
  return "protect_sales";
}

/**
 * The single global ordering. Deterministic tie-breaking, in the doctrine's order:
 *   1. doctrine tier   2. money at stake   3. urgency   4. stable id (never random).
 */
export function compareActions(a: OwnerDecision, b: OwnerDecision): number {
  const doctrine = DOCTRINE_RANK[classifyDoctrine(b)] - DOCTRINE_RANK[classifyDoctrine(a)];
  if (doctrine !== 0) return doctrine;

  const money = moneyMagnitude(b.estimatedImpact) - moneyMagnitude(a.estimatedImpact);
  if (money !== 0) return money;

  const urgency = URGENCY_RANK[b.category] - URGENCY_RANK[a.category];
  if (urgency !== 0) return urgency;

  return a.id.localeCompare(b.id);
}

/** A candidate is only usable if it can actually be shown and acted on. */
function isActionable(decision: OwnerDecision | null | undefined): decision is OwnerDecision {
  return Boolean(
    decision &&
      typeof decision.id === "string" &&
      decision.id.length > 0 &&
      typeof decision.title === "string" &&
      decision.title.trim().length > 0 &&
      typeof decision.recommendedAction === "string" &&
      decision.recommendedAction.trim().length > 0,
  );
}

export type CompressedActions = {
  /** The ≤3 winners of the single global contest — what the butcher does now. */
  doNow: OwnerDecision[];
  /** Every other valid action, preserved and ordered. Hidden by default, never lost. */
  later: OwnerDecision[];
  /** Internal-only evidence for every ranked action (for tests / audit / debugging). */
  evidence: ActionEvidence[];
  /** Candidates dropped for missing required fields — reported internally, never shown. */
  excluded: Array<{ id: string; reason: string }>;
};

/**
 * Compress all candidate actions into the top {@link DO_NOW_MAX} plus a Later reserve.
 *
 * - More than three candidates compress to exactly three.
 * - Fewer than three stay fewer — we never pad or invent an action.
 * - Bad candidates are excluded (reported internally), never crash the page.
 * - The returned objects are the same references handed in: nothing is rewritten.
 */
export function compressActions(candidates: OwnerDecision[]): CompressedActions {
  const excluded: Array<{ id: string; reason: string }> = [];
  const valid: OwnerDecision[] = [];

  // Loosely typed on purpose: the signature promises OwnerDecision[], but this is the
  // failure-mode guard for malformed runtime data, so we must not trust the static type.
  for (const candidate of (candidates ?? []) as Array<OwnerDecision | null | undefined>) {
    if (isActionable(candidate)) {
      valid.push(candidate);
      continue;
    }
    const rawId = (candidate as { id?: unknown } | null | undefined)?.id;
    excluded.push({ id: typeof rawId === "string" && rawId ? rawId : "(unknown)", reason: "missing required action fields" });
  }

  const ranked = [...valid].sort(compareActions);
  const doNow = ranked.slice(0, DO_NOW_MAX);
  const later = ranked.slice(DO_NOW_MAX);

  const evidence: ActionEvidence[] = ranked.map((decision, index) => {
    const doctrine = classifyDoctrine(decision);
    return {
      id: decision.id,
      doctrine,
      doctrineRank: DOCTRINE_RANK[doctrine],
      moneyMagnitude: moneyMagnitude(decision.estimatedImpact),
      urgencyRank: URGENCY_RANK[decision.category],
      rank: index + 1,
      won: index < DO_NOW_MAX,
    };
  });

  return { doNow, later, evidence, excluded };
}
