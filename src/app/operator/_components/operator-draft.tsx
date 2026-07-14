"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { saveOperatorDraft } from "@/app/actions/operator/drafts";
import {
  buildOperatorDraftSteps,
  draftSaveLabel,
  transitionDraftSaveState,
  type DraftSaveState,
  type DraftSaveStatus,
  type OperatorDraftWorkflow,
} from "@/lib/operator/workflows/drafts";

const SAVE_DEBOUNCE_MS = 250;

export function useOperatorDraftSave(input: {
  runId: string;
  workflow: OperatorDraftWorkflow;
  mode: string;
  lastSavedStep: string;
  answers: Record<string, unknown>;
  enabled: boolean;
}) {
  const [state, setState] = useState<DraftSaveState>({ status: "idle", consecutiveFailures: 0 });
  const stateRef = useRef(state);
  const latestRef = useRef({ answers: input.answers, lastSavedStep: input.lastSavedStep });
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  latestRef.current = { answers: input.answers, lastSavedStep: input.lastSavedStep };

  function apply(next: DraftSaveState) {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!input.enabled || !input.runId || !input.lastSavedStep) return;

    const timer = globalThis.setTimeout(() => {
      const snapshot = latestRef.current;
      queueRef.current = queueRef.current.catch(() => undefined).then(async () => {
        apply(transitionDraftSaveState(stateRef.current, "save-started"));
        try {
          const result = await saveOperatorDraft({
            runId: input.runId,
            workflow: input.workflow,
            steps: buildOperatorDraftSteps({
              workflow: input.workflow,
              mode: input.mode,
              lastSavedStep: snapshot.lastSavedStep,
              answers: snapshot.answers,
              draftFailures: stateRef.current.consecutiveFailures,
            }),
          });
          apply(transitionDraftSaveState(stateRef.current, result.ok ? "save-succeeded" : "save-failed"));
        } catch {
          // Network failures can reject a server-action promise entirely. Keep
          // the queue usable so the next transition retries automatically.
          apply(transitionDraftSaveState(stateRef.current, "save-failed"));
        }
      });
    }, SAVE_DEBOUNCE_MS);

    return () => globalThis.clearTimeout(timer);
    // Answers are captured after the transition through latestRef. Saving is
    // deliberately keyed to mode changes rather than every keypad keystroke.
  }, [input.enabled, input.lastSavedStep, input.mode, input.runId, input.workflow]);

  return {
    status: state.status,
    consecutiveFailures: state.consecutiveFailures,
    markResumed() {
      apply({ status: "saved", consecutiveFailures: 0 });
    },
    reset() {
      apply({ status: "idle", consecutiveFailures: 0 });
    },
  };
}

export function OperatorDraftStatus({ status }: { status: DraftSaveStatus }) {
  const label = draftSaveLabel(status);
  if (!label) return null;

  return (
    <p
      role="status"
      data-testid="operator-draft-status"
      className={[
        "mb-4 inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-sm font-semibold",
        status === "failed"
          ? "border-[var(--clay)] bg-[var(--paper)] text-[var(--clay)]"
          : "border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]",
      ].join(" ")}
    >
      {label}
    </p>
  );
}

export function OperatorDraftPrompt({
  lastSavedStep,
  onResume,
  onStartFresh,
  busy,
  error,
}: {
  lastSavedStep: string;
  onResume: () => void;
  onStartFresh: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <section
      data-testid="operator-draft-prompt"
      className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm"
    >
      <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">Carry on where you left off?</h2>
      <p className="mt-3 text-lg font-semibold text-[var(--muted)]">Saved up to: {lastSavedStep}</p>
      <div className="mt-6 grid gap-3">
        <PromptButton onClick={onResume} disabled={busy}>Carry on</PromptButton>
        <PromptButton onClick={onStartFresh} disabled={busy} muted>Start fresh</PromptButton>
      </div>
      {error ? <p className="mt-4 text-base font-semibold text-[var(--clay)]">{error}</p> : null}
    </section>
  );
}

function PromptButton({
  children,
  onClick,
  disabled,
  muted,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex min-h-[72px] w-full items-center justify-center rounded-2xl px-6 text-xl font-semibold disabled:opacity-50",
        muted ? "border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]" : "bg-[var(--brand)] text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
