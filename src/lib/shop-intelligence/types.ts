/**
 * V8 — Shop Intelligence layer.
 *
 * The brain that turns the signals PlaiceToMeat already computes into a single
 * "what matters today" picture for a first-time butcher. Every type here is plain
 * data so the whole engine stays pure and unit-testable, and the server layer can
 * feed it from existing reads with no new database tables.
 *
 * Golden Rule (V8.13): nothing in this layer changes stock, prices, orders or
 * costs. It produces *recommendations only*.
 */

/** Where a finding comes from — used to group the briefing into sections. */
export type IntelArea =
  | "stock" // running low / cover
  | "expiry" // about to go off
  | "waste" // money being lost
  | "margin" // profit / cost coverage
  | "compliance" // halal & food-safety papers
  | "yield" // reality learning: expected vs actual (V8.2 / V8.11)
  | "consistency" // cross-system contradictions (V8.12)
  | "discipline" // operational coach: process gaps (V8.5)
  | "orders" // order flow
  | "system"; // SMS / counter connection

export const INTEL_AREA_LABEL: Record<IntelArea, string> = {
  stock: "Stock",
  expiry: "Going off soon",
  waste: "Waste",
  margin: "Profit",
  compliance: "Halal & food safety",
  yield: "What the meat really gives",
  consistency: "Numbers that don't match",
  discipline: "Good habits",
  orders: "Orders",
  system: "Counter & texts",
};

/**
 * Internal severity (kept on the existing info/warning/urgent scale so it lines
 * up with `OwnerAction` and Dad Mode). The owner never sees these raw words.
 */
export type IntelSeverity = "info" | "warning" | "urgent";

export const SEVERITY_RANK: Record<IntelSeverity, number> = {
  urgent: 3,
  warning: 2,
  info: 1,
};

/** How much to trust a finding (V8.7). Mirrors the purchasing confidence scale. */
export type IntelConfidence = "low" | "medium" | "high";

export const CONFIDENCE_RANK: Record<IntelConfidence, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

export const CONFIDENCE_LABEL: Record<IntelConfidence, string> = {
  high: "High confidence",
  medium: "Some confidence",
  low: "Early signal",
};

/**
 * The evidence behind a finding's confidence (V8.7). Never let weak data look
 * strong: this records *exactly* what the conclusion is based on, in plain words.
 */
export type DataBasis = {
  confidence: IntelConfidence;
  /** One short line: "Based on 12 intakes" / "Based on 2 days of sales". */
  summary: string;
  /** The individual evidence points, e.g. "8 weeks of sales", "6 purchases". */
  points: string[];
};

/** A reference into the knowledge layer (V8.6). */
export type PlaybookRef = {
  slug: string;
  title: string;
};

/**
 * The core V8 output (V8.1). Every recommendation answers the three questions the
 * spec demands (V8.4): Why? (explanation) · What happens if ignored? (consequence)
 * · What should I do? (recommendedAction) — plus how much to trust it (basis) and
 * where to learn the job (playbook).
 */
export type Finding = {
  id: string;
  area: IntelArea;
  /** The headline, in plain butcher English. */
  finding: string;
  severity: IntelSeverity;
  /** Why? */
  explanation: string;
  /** What happens if ignored? */
  consequence: string;
  /** What should I do? (never an automatic action — owner decides) */
  recommendedAction: string;
  confidence: IntelConfidence;
  basis: DataBasis;
  playbook: PlaybookRef | null;
  /** Supporting numbers shown under the card. */
  metrics: Array<{ label: string; value: string }>;
  /** Provenance: synthesised here, or normalised from the existing action engine. */
  source: "engine" | "owner-action";
};

/** One line of the morning briefing (V8.3). */
export type BriefingItem = {
  id: string;
  text: string;
  severity: IntelSeverity;
  area: IntelArea;
};

export type DailyBriefing = {
  greeting: string;
  /** "3 things need your attention today." / "Nothing urgent this morning." */
  headline: string;
  actionCount: number;
  items: BriefingItem[];
  /** A calm closing line so the owner always knows where they stand. */
  reassurance: string | null;
};

/** One category of the Operational Health Score (V8.8). */
export type HealthCategory = {
  key:
    | "stock_accuracy"
    | "cost_coverage"
    | "compliance_readiness"
    | "purchasing_discipline"
    | "waste_tracking"
    | "order_flow";
  label: string;
  score: number; // 0–100
  band: "strong" | "fair" | "needs_attention" | "unknown";
  detail: string;
};

export type HealthScore = {
  /** 0–100 overall, or null when there isn't enough data to be honest. */
  score: number | null;
  band: "strong" | "fair" | "needs_attention" | "unknown";
  categories: HealthCategory[];
  strong: string[];
  needsAttention: string[];
};

/** The weekly management report (V8.10). */
export type WeeklyReport = {
  rangeLabel: string;
  revenue: number | null;
  topProduct: string | null;
  lowestProduct: string | null;
  biggestWasteSource: string | null;
  mostFrequentStockRisk: string | null;
  complianceSummary: string;
  notes: string[];
};

/**
 * A first-run teaching step for an owner who is new to both the software and the
 * trade. Each step is one concrete thing to set up, with a friendly butchery-aware
 * reason, and a `done` tick so progress feels rewarding rather than nagging.
 */
export type GettingStartedStep = {
  id: string;
  text: string;
  why: string;
  href: string;
  actionLabel: string;
  done: boolean;
};

export type GettingStarted = {
  /** Only shown while the shop is still being set up. */
  show: boolean;
  title: string;
  intro: string;
  steps: GettingStartedStep[];
  doneCount: number;
  totalCount: number;
};

/** The whole V8 picture, returned by the engine and rendered by the briefing page. */
export type ShopIntelligence = {
  generatedAt: string;
  dataConfigured: boolean;
  /** Day-one teaching for a brand-new shop (empty once set up). */
  gettingStarted: GettingStarted;
  briefing: DailyBriefing;
  health: HealthScore;
  findings: Finding[];
  weekly: WeeklyReport;
  /** Top-line confidence over the whole picture (V8.7). */
  confidence: DataBasis;
};
