/**
 * V10 Phase 2 — guided operational capture (pure types).
 *
 * The opening, closing and stock-count rituals are data-capturing workflows, not
 * decoration: every step the owner completes is persisted as an append-only event with
 * provenance. These types are plain data so the resume/progress/receipt logic stays pure
 * and fully unit-testable, mirroring the V8/V9 layering.
 */

/** The three rituals. */
export type OpsKind = "opening" | "closing" | "stock_count";

export const OPS_KIND_LABEL: Record<OpsKind, string> = {
  opening: "Opening the shop",
  closing: "Closing the shop",
  stock_count: "Stock count",
};

/** A step outcome. `skipped`/`na` are real, recorded states — never a fake tick. */
export type OpsStepState = "done" | "skipped" | "na";

/** How a step collects information, if any (drives the 2b UI). */
export type OpsStepInput =
  | { kind: "confirm" } // just "done / skip"
  | { kind: "number"; unit: string; label: string }; // e.g. a fridge temperature

/** One fixed step in a ritual's checklist. */
export type ChecklistStepDef = {
  key: string;
  title: string;
  /** Plain-English reason, in business/food-safety terms — never software talk. */
  why: string;
  input: OpsStepInput;
  /** Food-safety-critical steps can't be silently skipped without an explicit note (2b). */
  critical: boolean;
  /** Optional jump to the real capture flow (e.g. log waste, do a stock count). */
  action?: { href: string; label: string };
};

export type ChecklistDefinition = {
  kind: OpsKind;
  title: string;
  intro: string;
  steps: ChecklistStepDef[];
};

/** A persisted session row (subset the UI/reads care about). */
export type OpsSession = {
  id: string;
  branchId: string;
  kind: OpsKind;
  businessDate: string;
  status: "in_progress" | "completed" | "abandoned";
  startedAt: string;
  completedAt: string | null;
};

/** A persisted step event row. */
export type OpsEvent = {
  id: string;
  stepKey: string;
  state: OpsStepState;
  payload: Record<string, unknown>;
  createdAt: string;
};

/** A step with its latest recorded outcome folded in (null = not yet handled). */
export type ChecklistStepStatus = {
  def: ChecklistStepDef;
  state: OpsStepState | null;
  payload: Record<string, unknown> | null;
};

/** The resumable picture of a ritual: what's handled, what's left, what's next. */
export type ChecklistSummary = {
  steps: ChecklistStepStatus[];
  handledCount: number;
  totalCount: number;
  /** First step with no recorded event — where "resume" picks up. Null when all handled. */
  nextStepKey: string | null;
  allHandled: boolean;
};

/** A completion receipt — persisted, so it survives a refresh. */
export type ChecklistReceiptLine = {
  title: string;
  state: OpsStepState | null;
  detail: string | null;
};

export type ChecklistReceipt = {
  kind: OpsKind;
  title: string;
  sessionId?: string | null;
  definitionKey?: string | null;
  definitionVersion?: number | null;
  actorId?: string | null;
  branchId?: string | null;
  completedAt?: string | null;
  completedAtLabel: string | null;
  handledCount: number;
  totalCount: number;
  lines: ChecklistReceiptLine[];
};
