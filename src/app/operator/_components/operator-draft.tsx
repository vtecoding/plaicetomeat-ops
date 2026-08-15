"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { saveOperatorDraft } from "@/app/actions/operator/drafts";
import {
  buildOperatorDraftSteps,
  transitionDraftSaveState,
  type DraftSaveState,
  type DraftSaveStatus,
  type OperatorDraftWorkflow,
} from "@/lib/operator/workflows/drafts";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import type { OperatorTranslationKey } from "@/lib/operator/i18n/resources";

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
  const { t } = useOperatorI18n();
  const label = status === "saving"
    ? t("draft.saving")
    : status === "saved"
      ? t("draft.saved")
      : status === "failed"
        ? t("draft.failed")
        : "";
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
  const { t, error: operatorError } = useOperatorI18n();
  const step = translateDraftStep(lastSavedStep, t);
  return (
    <section
      data-testid="operator-draft-prompt"
      className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm"
    >
      <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{t("draft.resumeTitle")}</h2>
      <p className="mt-3 text-lg font-semibold text-[var(--muted)]">{t("draft.savedUpTo", { step })}</p>
      <div className="mt-6 grid gap-3">
        <PromptButton onClick={onResume} disabled={busy}>{t("draft.carryOn")}</PromptButton>
        <PromptButton onClick={onStartFresh} disabled={busy} muted>{t("draft.startFresh")}</PromptButton>
      </div>
      {error ? <p className="mt-4 text-base font-semibold text-[var(--clay)]">{operatorError(error)}</p> : null}
    </section>
  );
}

const DRAFT_STEP_KEYS: Record<string, OperatorTranslationKey> = {
  "serve.addMore": "draft.step.serve.addMore",
  "serve.what": "draft.step.serve.what",
  "serve.item": "draft.step.serve.item",
  "serve.amount": "draft.step.serve.amount",
  "serve.added": "draft.step.serve.added",
  "serve.pay": "draft.step.serve.pay",
  "stock.what": "draft.step.stock.what",
  "stock.arrived": "draft.step.stock.arrived",
  "stock.amount": "draft.step.stock.amount",
  "stock.supplier": "draft.step.stock.supplier",
  "stock.photo": "draft.step.stock.photo",
  "stock.storage": "draft.step.stock.storage",
  "stock.expiry": "draft.step.stock.expiry",
  "stock.ranOut": "draft.step.stock.ranOut",
  "stock.empty": "draft.step.stock.empty",
  "waste.start": "draft.step.waste.start",
  "waste.product": "draft.step.waste.product",
  "waste.amount": "draft.step.waste.amount",
  "waste.reason": "draft.step.waste.reason",
  "waste.photo": "draft.step.waste.photo",
  // Compatibility with drafts created before stable presentation keys existed.
  "Add more?": "draft.step.serve.addMore",
  "What did they buy?": "draft.step.serve.what",
  "Item chosen": "draft.step.serve.item",
  "How much?": "draft.step.serve.amount",
  "Item added": "draft.step.serve.added",
  "How did they pay?": "draft.step.serve.pay",
  "What happened?": "draft.step.stock.what",
  "What arrived?": "draft.step.stock.arrived",
  "How much arrived?": "draft.step.stock.amount",
  "Who brought it?": "draft.step.stock.supplier",
  "Photo of the delivery note?": "draft.step.stock.photo",
  "Where did you put it?": "draft.step.stock.storage",
  "When does it go off?": "draft.step.stock.expiry",
  "What ran out?": "draft.step.stock.ranOut",
  "Are you sure it is empty?": "draft.step.stock.empty",
  "Did you throw anything away?": "draft.step.waste.start",
  "What was thrown away?": "draft.step.waste.product",
  "Why?": "draft.step.waste.reason",
  Photo: "draft.step.waste.photo",
};

function translateDraftStep(lastSavedStep: string, t: ReturnType<typeof useOperatorI18n>["t"]): string {
  const key = DRAFT_STEP_KEYS[lastSavedStep];
  return key ? t(key) : t("common.saved");
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
