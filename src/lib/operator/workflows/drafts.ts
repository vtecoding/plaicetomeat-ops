export const OPERATOR_DRAFT_SCHEMA_VERSION = 1 as const;

export const OPERATOR_DRAFT_WORKFLOWS = ["serve", "delivery", "waste"] as const;

export type OperatorDraftWorkflow = (typeof OPERATOR_DRAFT_WORKFLOWS)[number];

export type OperatorDraftRecord = {
  runId: string;
  workflow: OperatorDraftWorkflow;
  steps: Record<string, unknown>;
  updatedAt: string;
};

export type OperatorDraftEnvelope = {
  schemaVersion: typeof OPERATOR_DRAFT_SCHEMA_VERSION;
  workflow: OperatorDraftWorkflow;
  mode: string;
  lastSavedStep: string;
  answers: Record<string, unknown>;
  draftFailures: number;
};

export type DraftSaveStatus = "idle" | "saving" | "saved" | "failed";

export type DraftSaveState = {
  status: DraftSaveStatus;
  consecutiveFailures: number;
};

export type DraftSaveEvent = "save-started" | "save-succeeded" | "save-failed";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isOperatorDraftWorkflow(value: unknown): value is OperatorDraftWorkflow {
  return typeof value === "string" && OPERATOR_DRAFT_WORKFLOWS.includes(value as OperatorDraftWorkflow);
}

export function operatorDraftBusinessDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function buildOperatorDraftSteps(input: {
  workflow: OperatorDraftWorkflow;
  mode: string;
  lastSavedStep: string;
  answers: Record<string, unknown>;
  draftFailures?: number;
}): Record<string, unknown> {
  return {
    schema_version: OPERATOR_DRAFT_SCHEMA_VERSION,
    workflow: input.workflow,
    mode: input.mode,
    last_saved_step: input.lastSavedStep,
    answers: input.answers,
    draft_failures: Math.max(0, Math.floor(input.draftFailures ?? 0)),
  };
}

/**
 * Reads only the resumable UX envelope. Business writes never trust this state;
 * their existing server actions validate every value again on completion.
 */
export function parseOperatorDraftSteps(
  value: unknown,
  workflow: OperatorDraftWorkflow,
  allowedModes: readonly string[],
): OperatorDraftEnvelope | null {
  if (!isPlainRecord(value)) return null;
  if (value.schema_version !== OPERATOR_DRAFT_SCHEMA_VERSION || value.workflow !== workflow) return null;
  if (typeof value.mode !== "string" || !allowedModes.includes(value.mode)) return null;
  if (typeof value.last_saved_step !== "string" || !value.last_saved_step.trim()) return null;
  if (!isPlainRecord(value.answers)) return null;

  const rawFailures = typeof value.draft_failures === "number" ? value.draft_failures : 0;
  return {
    schemaVersion: OPERATOR_DRAFT_SCHEMA_VERSION,
    workflow,
    mode: value.mode,
    lastSavedStep: value.last_saved_step.trim().slice(0, 80),
    answers: value.answers,
    draftFailures: Number.isFinite(rawFailures) ? Math.max(0, Math.floor(rawFailures)) : 0,
  };
}

export function transitionDraftSaveState(state: DraftSaveState, event: DraftSaveEvent): DraftSaveState {
  if (event === "save-started") return { ...state, status: "saving" };
  if (event === "save-succeeded") return { status: "saved", consecutiveFailures: 0 };
  return { status: "failed", consecutiveFailures: state.consecutiveFailures + 1 };
}

export function draftSaveLabel(status: DraftSaveStatus): string | null {
  if (status === "saving") return "Saving…";
  if (status === "saved") return "Saved for resume";
  if (status === "failed") return "Not saved for resume — keep going, the sale still works";
  return null;
}
