import type { OperatorLocale } from "@/lib/operator/i18n/resources";
import { completeShopDaySteps } from "./scenario";
import { applyTutorialEvent, cloneSimulation, createInitialSimulation } from "./simulation";
import type { DryRunSession, TutorialEvent } from "./types";

export const DRY_RUN_STORAGE_KEY = "ptm_operator_dry_run_v2";
export const DRY_RUN_DURATION_MS = 8 * 60 * 60 * 1000;

export function createDryRunSession(locale: OperatorLocale, now = new Date(), id = crypto.randomUUID()): DryRunSession {
  const initial = createInitialSimulation();
  return { id, scenarioId: "complete-shop-day-v2", mode: "dry-run", locale, currentStep: 0, completedSteps: [], simulatedState: initial, snapshots: [cloneSimulation(initial)], processedEventIds: [], startedAt: now.toISOString(), expiresAt: new Date(now.getTime() + DRY_RUN_DURATION_MS).toISOString(), status: "active" };
}

export function acceptsEvent(session: DryRunSession, event: TutorialEvent) {
  const step = completeShopDaySteps[session.currentStep];
  if (!step?.requiredEvent || step.requiredEvent !== event.name) return false;
  if (session.processedEventIds.includes(event.id)) return false;
  return step.expectedValue === undefined || String(step.expectedValue) === String(event.value);
}

function advance(session: DryRunSession, simulatedState: DryRunSession["simulatedState"], eventId?: string): DryRunSession {
  const step = completeShopDaySteps[session.currentStep];
  const nextIndex = Math.min(session.currentStep + 1, completeShopDaySteps.length - 1);
  const snapshots = session.snapshots.slice(0, nextIndex);
  snapshots[nextIndex] = cloneSimulation(simulatedState);
  return { ...session, currentStep: nextIndex, completedSteps: step ? [...session.completedSteps.filter((id) => id !== step.id), step.id] : session.completedSteps, simulatedState, snapshots, processedEventIds: eventId ? [...session.processedEventIds, eventId].slice(-100) : session.processedEventIds };
}

export function handleTutorialEvent(session: DryRunSession, event: TutorialEvent): DryRunSession {
  if (session.status !== "active" || !acceptsEvent(session, event)) return session;
  return advance(session, applyTutorialEvent(session.simulatedState, event), event.id);
}

export function advanceInstruction(session: DryRunSession): DryRunSession {
  const step = completeShopDaySteps[session.currentStep];
  if (!step || step.requiredEvent || session.status !== "active") return session;
  if (step.id === "complete") return { ...session, status: "completed" };
  return advance(session, session.simulatedState);
}

export function goBack(session: DryRunSession): DryRunSession {
  const previous = Math.max(0, session.currentStep - 1);
  return { ...session, status: "active", currentStep: previous, completedSteps: completeShopDaySteps.slice(0, previous).map((step) => step.id), simulatedState: cloneSimulation(session.snapshots[previous] ?? createInitialSimulation()), snapshots: session.snapshots.slice(0, previous + 1), processedEventIds: [] };
}

export function restartSession(session: DryRunSession, now = new Date()): DryRunSession { return createDryRunSession(session.locale, now, session.id); }
export function changeSessionLocale(session: DryRunSession, locale: OperatorLocale): DryRunSession { return { ...session, locale }; }
export function serializeSession(session: DryRunSession) { return JSON.stringify(session); }

export function restoreSession(value: string | null, now = new Date()): DryRunSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as DryRunSession;
    if (parsed.mode !== "dry-run" || parsed.scenarioId !== "complete-shop-day-v2") return null;
    if (new Date(parsed.expiresAt).getTime() <= now.getTime()) return null;
    if (!Number.isInteger(parsed.currentStep) || parsed.currentStep < 0 || parsed.currentStep >= completeShopDaySteps.length) return null;
    if (!Array.isArray(parsed.snapshots) || !Array.isArray(parsed.processedEventIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}
