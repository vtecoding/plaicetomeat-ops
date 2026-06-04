/**
 * V10 Phase 2 — pure resume / progress / receipt logic.
 *
 * Step events are append-only, so the "current state" of a step is simply its latest
 * event. From that we can rebuild exactly where a half-finished ritual left off (so a
 * refresh resumes correctly) and turn a completed session into a persisted receipt.
 * No I/O — this is the unit-tested heart of the capture layer.
 */
import type {
  ChecklistDefinition,
  ChecklistReceipt,
  ChecklistReceiptLine,
  ChecklistStepStatus,
  ChecklistSummary,
  OpsEvent,
} from "./types";

/** Latest event per step key (append-only log → current state). */
export function latestEventByStep(events: OpsEvent[]): Map<string, OpsEvent> {
  const latest = new Map<string, OpsEvent>();
  for (const event of events) {
    const existing = latest.get(event.stepKey);
    if (!existing || event.createdAt >= existing.createdAt) {
      latest.set(event.stepKey, event);
    }
  }
  return latest;
}

/** Fold recorded events onto a checklist definition to get a resumable summary. */
export function summariseChecklist(definition: ChecklistDefinition, events: OpsEvent[]): ChecklistSummary {
  const latest = latestEventByStep(events);

  const steps: ChecklistStepStatus[] = definition.steps.map((def) => {
    const event = latest.get(def.key);
    return {
      def,
      state: event ? event.state : null,
      payload: event ? event.payload : null,
    };
  });

  const handledCount = steps.filter((step) => step.state !== null).length;
  const nextStep = steps.find((step) => step.state === null);

  return {
    steps,
    handledCount,
    totalCount: steps.length,
    nextStepKey: nextStep ? nextStep.def.key : null,
    allHandled: handledCount === steps.length,
  };
}

/** A short human detail for a step's recorded payload (e.g. "3.5 °C", "£120.00"). */
function describePayload(definition: ChecklistDefinition, stepKey: string, payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const def = definition.steps.find((step) => step.key === stepKey);
  if (!def || def.input.kind !== "number") return null;
  const value = payload.value;
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return def.input.unit === "£" ? `£${value.toFixed(2)}` : `${value} ${def.input.unit}`;
}

/** Build a persisted completion receipt from a session's events. */
export function buildReceipt(
  definition: ChecklistDefinition,
  events: OpsEvent[],
  completedAtLabel: string | null,
): ChecklistReceipt {
  const summary = summariseChecklist(definition, events);

  const lines: ChecklistReceiptLine[] = summary.steps.map((step) => ({
    title: step.def.title,
    state: step.state,
    detail: describePayload(definition, step.def.key, step.payload),
  }));

  return {
    kind: definition.kind,
    title: definition.title,
    completedAtLabel,
    handledCount: summary.handledCount,
    totalCount: summary.totalCount,
    lines,
  };
}

/** Stock-count variance in kg (counted − system). Positive = more on the shelf than expected. */
export function stockVarianceKg(systemKg: number, countedKg: number): number {
  return Math.round((countedKg - systemKg) * 1000) / 1000;
}
