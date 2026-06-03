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
import type { DataBasis, GettingStarted, PlaybookRef } from "@/lib/shop-intelligence/types";

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

/** The whole Owner Brain picture, returned by the engine and rendered by /admin/today. */
export type OwnerBrain = {
  generatedAt: string;
  /**
   * While the shop is still being set up we hide all intelligence and show only the
   * Getting Started steps — a new owner shouldn't be judged on data they haven't entered.
   */
  setupMode: boolean;
  gettingStarted: GettingStarted;
  status: ShopStatus;
  urgent: OwnerDecision[];
  important: OwnerDecision[];
  opportunities: OwnerDecision[];
  weekly: OwnerWeeklySummary;
};
