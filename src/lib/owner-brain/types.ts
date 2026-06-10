/**
 * V9 — Owner Brain & Decision Compression Layer.
 *
 * V8 already works out everything needed to run the shop (findings, health,
 * yield-reality, weekly report, getting-started). V9 doesn't compute anything new —
 * it *compresses* that intelligence into business decisions a first-time, non-technical
 * butcher can act on in under a minute.
 *
 * Every type here is plain data. The whole layer is pure and reads a V8
 * `ShopIntelligence`, so it never touches the database and is fully unit-testable.
 *
 * Golden Rule (inherited from V8.13): nothing here changes stock, prices, orders or
 * costs. It produces *decisions to consider* only.
 */
import type { DataBasis, GettingStarted, IntelArea, PlaybookRef } from "@/lib/shop-intelligence/types";

/** The three — and only three — buckets the owner ever sees. */
export type DecisionCategory = "urgent" | "important" | "opportunity";

export const CATEGORY_LABEL: Record<DecisionCategory, string> = {
  urgent: "Urgent",
  important: "Important",
  opportunity: "Opportunity",
};

/** When the owner should act. Never a raw severity word. */
export type DueWindow = "today" | "this_week" | "when_you_can";

export const DUE_WINDOW_LABEL: Record<DueWindow, string> = {
  today: "Today",
  this_week: "This week",
  when_you_can: "When you can",
};

/**
 * A plain-English money estimate. We only ever show a number we can stand behind:
 * when the data can't price something honestly, `kind` is `none` and `label`
 * explains the value in words instead of inventing a figure (V8 honesty rule).
 */
export type MoneyImpact = {
  kind: "loss" | "risk" | "opportunity" | "none";
  /** Recurring money, per week. */
  weeklyLow?: number;
  weeklyHigh?: number;
  /** A one-off amount currently exposed (e.g. stock about to be binned). */
  oneOff?: number;
  /** The owner-facing line, e.g. "£40–£120 per week" or "Hard to put a figure on yet". */
  label: string;
};

/**
 * One compressed decision (the V9 schema). Built from a V8 `Finding`, it answers the
 * four questions the spec demands of anything on screen: what happened, why it matters,
 * what to do, and how much money is involved — plus who and when.
 */
export type OwnerDecision = {
  id: string;
  category: DecisionCategory;
  /** The V8 area the decision came from — the substrate the V15 doctrine classifier reads. */
  area: IntelArea;
  /** Higher = show sooner. Drives the order within a bucket. */
  priority: number;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  recommendedAction: string;
  estimatedImpact: MoneyImpact;
  /** Generic role label, e.g. "You / Owner" or "Counter team". */
  owner: string;
  dueWindow: DueWindow;
  /** How much to trust it + the supporting numbers (from the V8 finding). */
  sourceEvidence: {
    basis: DataBasis;
    metrics: Array<{ label: string; value: string }>;
  };
  /** Where to learn the job, if there's a playbook for it. */
  playbook: PlaybookRef | null;
};

/**
 * V15.4 — Intelligence Firewall · the INTERNAL scored action.
 *
 * This is the formal name for the decision-engine object. It carries calculations — a
 * numeric `priority`, a `category`/severity, money at stake, and `sourceEvidence.basis`
 * (which includes a confidence). Scoring and compression operate on it. It must NEVER be
 * handed to an operator-facing UI component: the only path to the UI is
 * {@link OperatorAction}, produced by `toOperatorAction`.
 */
export type ScoredAction = OwnerDecision;

/**
 * V15.2 — the verb a primary action asks the operator to perform. Drives one-tap routing
 * and the operator-action shape. Defined here (not in `action-target.ts`) so the external
 * {@link OperatorAction} type can reference it without a circular import.
 */
export type ActionType = "count" | "order" | "sell" | "fix" | "review";

/**
 * V15.4 — the lifecycle state an action can be in (shape only in this release; there is no
 * persistence yet, so the operator layer always sees "available").
 */
export type ActionCompletionState = "available" | "in_progress" | "completed" | "dismissed";

/**
 * V15.4 — Intelligence Firewall · the EXTERNAL operator action.
 *
 * The only shape the operator layer (TODAY, Later, decision detail, guided walk, morning
 * briefing) ever receives. It is structurally incapable of carrying a calculation: there is
 * no `priority`, `confidence`, `score`, `severity`, `rank`, evidence or raw signal anywhere
 * on it. Every field is a safe display string the butcher can read. A future
 * `{action.confidence}` is impossible because the field does not exist.
 */
export type OperatorAction = {
  id: string;
  /** The verb the action asks for (count / order / sell / fix / review). */
  actionType: ActionType;
  /** What — the headline. */
  title: string;
  /** Plain "what happened" narrative. */
  whatHappened: string;
  /** Plain "why it matters" narrative. */
  whyItMatters: string;
  /** Plain "what to do" line. */
  recommendedAction: string;
  /** The one-line "why" for the card — money label when priceable, else what happened. */
  reason: string;
  /** Safe money display, e.g. "£40–£120 per week" or "Hard to put a figure on yet". Never a formula. */
  impactLabel: string;
  /** Display tone for the money chip — derived from the money kind, not a severity score. */
  impactTone: MoneyImpact["kind"];
  /** Generic role label, e.g. "You / Owner". */
  owner: string;
  /** When, as a plain word: "Today" / "This week" / "When you can". */
  dueLabel: string;
  /** Where the one tap goes (the work screen). */
  destination: string;
  /** The item to focus on arrival, e.g. "Chicken Breast" (null when none applies). */
  entityLabel: string | null;
  /** The one-tap link (destination + focus context). */
  href: string;
  /** Plain "what this is based on" summary — text only, never a confidence value. */
  basisSummary: string;
  /** Safe supporting facts shown under the detail (e.g. "Batches: 3"). Never scores. */
  supportingFacts: Array<{ label: string; value: string }>;
  /** Where to learn the job, if there's a playbook for it. */
  playbook: PlaybookRef | null;
  /** Lifecycle state (always "available" in this release). */
  completion: ActionCompletionState;
};

/** Plain status word that replaces the numeric health score on the Owner Brain. */
export type ShopStatusBand = "good" | "needs_attention" | "unknown";

export const SHOP_STATUS_LABEL: Record<ShopStatusBand, string> = {
  good: "Good",
  needs_attention: "Needs attention",
  unknown: "Unknown",
};

export type ShopStatus = {
  band: ShopStatusBand;
  /** "How the shop is doing" headline sentence, no numbers. */
  headline: string;
  /** ✓ things that are going well. */
  good: string[];
  /** ⚠ things to keep an eye on. */
  watch: string[];
};

/** The single-page weekly summary (V9): three of each, plain English, no charts. */
export type OwnerWeeklySummary = {
  rangeLabel: string;
  wins: string[];
  risks: string[];
  opportunities: string[];
};

/**
 * V10 — the "shape of the day". A one-glance read on how much the morning asks of the
 * owner, plus the ordered list of things to walk through. Pure: derived only from the
 * decision buckets, never invents a number it can't stand behind (an honest, rounded
 * minute estimate, or none).
 */
export type DayShape = {
  /** True when nothing urgent or important needs the owner — clear to trade. */
  allClear: boolean;
  /** Urgent + important count — the things worth walking through this morning. */
  needsYouCount: number;
  /** Ordered steps for the guided walk, as operator-safe actions. */
  steps: OperatorAction[];
  /** Honest, rounded time estimate in minutes (0 when all clear). */
  estimateMinutes: number;
  /** Short time phrase, e.g. "about 10 minutes" / "a few minutes" (null when all clear). */
  timeLabel: string | null;
  /** Plain-English one-liner, e.g. "3 things need you today — about 10 minutes." */
  headline: string;
};

/**
 * V15 — Action Compression doctrine tiers.
 *
 * Every candidate action is classified into exactly one tier. Tiers — not the old
 * Urgent/Important/Opportunity buckets — decide what the butcher sees: prevent_loss
 * always beats improve_profit, regardless of which visual category a finding came from.
 * Highest first: prevent_loss > prevent_waste > prevent_stockout > protect_sales >
 * reduce_work > improve_profit.
 */
export type DoctrineTier =
  | "prevent_loss"
  | "prevent_waste"
  | "prevent_stockout"
  | "protect_sales"
  | "reduce_work"
  | "improve_profit";

/**
 * V15.3 — the trusted yesterday/this-morning signal the Morning Briefing reads.
 *
 * These are the same numbers the operational snapshot already computes from real records
 * (V14 truth). The briefing only ever reads them to choose *words* — it never shows a
 * figure, so the operator sees "Yesterday was steady", never "£420 taken / 1.2 kg wasted".
 */
export type MorningSignal = {
  /** Active batches expiring today or already expired. */
  expiringBatches: number;
  /** Supplier certificates that are not healthy (expiring / expired / missing). */
  certificatesExpiring: number;
  /** Value of stock written off yesterday (read for "was there waste?", never shown). */
  wasteYesterday: number;
  /** Yesterday's takings (read for "did the shop trade?", never shown). */
  revenueYesterday: number;
};

/**
 * V15.3 — the Morning Briefing: a ≤100-word, three-section orientation the owner reads in
 * under 30 seconds *before* the actions. It provides context; the actions provide
 * execution. It carries no metrics, no confidence, no ranking — only plain sentences.
 */
export type MorningBriefing = {
  /** Section 1 — what yesterday was like (context). */
  yesterday: string;
  /** Section 2 — the shape of today (never contradicts Do Now). */
  today: string;
  /** Section 3 — what is NOT a problem (reduces anxiety). Always present. */
  ignore: string;
  /** Total words across the three sections — enforced ≤ {@link BRIEFING_WORD_LIMIT}. */
  wordCount: number;
};

/**
 * V15 — internal evidence for why an action won (or lost) the compression contest.
 *
 * This is for tests, audit and debugging ONLY. It is never rendered: the butcher must
 * never see a score, a rank, a doctrine value or a confidence weight (doctrine).
 */
export type ActionEvidence = {
  id: string;
  doctrine: DoctrineTier;
  /** 6 (prevent_loss) … 1 (improve_profit). */
  doctrineRank: number;
  moneyMagnitude: number;
  /** 3 (urgent) … 1 (opportunity). */
  urgencyRank: number;
  /** 1-based position in the single global contest. */
  rank: number;
  /** True when this action made the DO NOW top three. */
  won: boolean;
};

/**
 * The whole Owner Brain picture, returned by the engine and rendered by /admin/today.
 *
 * V15.4 — this is an OPERATOR-SAFE object. Every action it carries is an
 * {@link OperatorAction}: there is no scored decision, no evidence and no internal number
 * anywhere on it. The scored picture lives only in {@link DecisionDiagnostics}, reachable
 * via `getDecisionDiagnostics` for audit/dev — never through this object.
 */
export type OwnerBrain = {
  generatedAt: string;
  /**
   * While the shop is still being set up we hide all intelligence and show only the
   * Getting Started steps — a new owner shouldn't be judged on data they haven't entered.
   */
  setupMode: boolean;
  gettingStarted: GettingStarted;
  status: ShopStatus;
  /**
   * V15 — the compressed picture as operator actions. `doNow` is the ≤3 actions that won
   * the single global contest; `later` holds every other valid action (preserved, never
   * lost). These are what /admin/today renders.
   */
  doNow: OperatorAction[];
  later: OperatorAction[];
  /** Urgent + important, converted to safe operator actions, for the opt-in guided walk. */
  walkSteps: OperatorAction[];
  /** How many growth opportunities exist — a count only (the walk's "ways to grow" link). */
  opportunityCount: number;
  weekly: OwnerWeeklySummary;
};

/**
 * V15.4 — Intelligence Firewall · the INTERNAL diagnostics bundle.
 *
 * The scored picture, kept for audit, explainability and dev tooling. It carries
 * {@link ScoredAction}s and ranking {@link ActionEvidence}. It is produced by
 * `getDecisionDiagnostics` and must NEVER be imported by an operator-facing surface.
 */
export type DecisionDiagnostics = {
  doNow: ScoredAction[];
  later: ScoredAction[];
  urgent: ScoredAction[];
  important: ScoredAction[];
  opportunities: ScoredAction[];
  /** Why each action ranked where it did (score components, doctrine, win/loss). */
  evidence: ActionEvidence[];
};
