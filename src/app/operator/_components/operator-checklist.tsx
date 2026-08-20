"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2 } from "lucide-react";

import {
  completeChecklist,
  recordChecklistStep,
  startOrResumeChecklist,
} from "@/app/actions/ops-capture";
import { getChecklist } from "@/lib/ops-capture/checklists";
import type { MoneyPictureInput } from "@/lib/ops-capture/money-context";
import type { ChecklistReceipt, ChecklistSummary, OpsStepState } from "@/lib/ops-capture/types";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import { LIVE_EXECUTION_CONTEXT } from "@/lib/operator/execution-context";
import { useOperatorDryRun } from "@/lib/operator/tutorial/context";
import { completeShopDaySteps } from "@/lib/operator/tutorial/scenario";
import { operatorMoney, type OperatorTranslationKey } from "@/lib/operator/i18n/resources";

// V17 Phase 2 — the operator-friendly face of the EXISTING opening/closing ritual.
//
// This is NOT a second checklist: it renders the same step definitions and calls
// the same ops-capture server actions (start / record / complete) as the owner's
// GuidedChecklist, so it produces byte-identical backend records (sessions, step
// events, completion). It only changes the skin: one big question at a time, big
// Yes / Not yet buttons, dot progress (never a number bar), and plain reassurance.

type StepRecord = { state: OpsStepState; payload: Record<string, unknown> };
type Kind = "opening" | "closing";

function completeTutorialChecklistStep(index: number): { kind: Kind; key: string | null } | null {
  const id = completeShopDaySteps[index]?.id;
  const map: Record<string, { kind: Kind; key: string | null }> = {
    "open.checklist": { kind: "opening", key: "display_ready" },
    "open.temperature": { kind: "opening", key: "fridge_temp" },
    "open.float": { kind: "opening", key: "float_ready" },
    "open.confirm": { kind: "opening", key: null },
    "close.checklist": { kind: "closing", key: "clean_done" },
    "close.temperature": { kind: "closing", key: "fridges_closed" },
    "close.till": { kind: "closing", key: "cash_counted" },
    "close.confirm": { kind: "closing", key: null },
  };
  return id ? map[id] ?? null : null;
}

/** A suggested value for a number step, drawn from history, that the operator confirms. */
export type NumberPrefill = { value: number; source: string | null };

/**
 * V18 A1: server-provided context shown ABOVE a money step's input — e.g.
 * "Expected in till: £142.50" plus the day's recorded till movements. The value
 * is deliberately NOT prefilled (the operator must count); when the step saves,
 * expectedPence is persisted in the payload as evidence of what was shown.
 */
export type NumberContext = { heading: string; lines?: string[]; expectedPence?: number | null };

function seedStates(summary: ChecklistSummary): Record<string, StepRecord> {
  const out: Record<string, StepRecord> = {};
  for (const step of summary.steps) {
    if (step.state !== null) out[step.def.key] = { state: step.state, payload: step.payload ?? {} };
  }
  return out;
}

export function OperatorChecklist({
  branchId,
  kind,
  initialSessionId,
  initialSummary,
  initialReceipt,
  numberPrefills,
  moneyPicture,
}: {
  branchId: string;
  kind: Kind;
  initialSessionId: string | null;
  initialSummary: ChecklistSummary;
  initialReceipt: ChecklistReceipt | null;
  numberPrefills?: Record<string, NumberPrefill>;
  moneyPicture?: MoneyPictureInput | null;
}) {
  const { t, error: operatorError, locale } = useOperatorI18n();
  const dryRun = useOperatorDryRun();
  const definition = useMemo(() => getChecklist(kind), [kind]);
  const steps = definition.steps;

  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [states, setStates] = useState<Record<string, StepRecord>>(() => seedStates(initialSummary));
  const [numberValue, setNumberValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean>(initialReceipt !== null);

  const tutorialStepId = dryRun.session?.status === "active" ? completeTutorialChecklistStep(dryRun.session.currentStep) : null;
  const tutorialKey = tutorialStepId && tutorialStepId.kind === kind ? tutorialStepId.key : undefined;
  const tutorialFinishing = tutorialStepId?.kind === kind && tutorialStepId.key === null;
  const activeIndex = dryRun.active
    ? (tutorialKey ? steps.findIndex((step) => step.key === tutorialKey) : -1)
    : steps.findIndex((step) => !states[step.key]);
  const allHandled = dryRun.active ? tutorialFinishing : activeIndex === -1;
  const activeStep = (!dryRun.active && done) || allHandled ? null : steps[activeIndex];
  const handledCount = Object.keys(states).length;

  const activePrefill = activeStep ? numberPrefills?.[activeStep.key] : undefined;
  const numberContexts = useMemo(() => buildMoneyContexts(moneyPicture, t, locale), [locale, moneyPicture, t]);
  const activeContext = activeStep ? numberContexts[activeStep.key] : undefined;
  const activeTitle = activeStep
    ? t(`checklist.${kind}.${activeStep.key}.title` as OperatorTranslationKey)
    : "";
  const activeWhy = activeStep
    ? t(`checklist.${kind}.${activeStep.key}.why` as OperatorTranslationKey)
    : "";

  // Seed the number field with a suggested value when a prefilled step opens (e.g. the
  // opening float). The operator can edit it before saving, so nothing is silently kept.
  useEffect(() => {
    setNumberValue(activePrefill ? String(activePrefill.value) : "");
  }, [activeStep?.key, activePrefill]);

  if (done && !dryRun.active) {
    return <Finished kind={kind} />;
  }

  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    if (dryRun.active) {
      const practiceId = `dry-run-${kind}`;
      setSessionId(practiceId);
      return practiceId;
    }
    const res = await startOrResumeChecklist({ branchId, kind, executionContext: LIVE_EXECUTION_CONTEXT });
    if (!res.ok || !res.id) {
      setError(res.ok ? "i18n:checklist.startError" : res.message);
      return null;
    }
    setSessionId(res.id);
    return res.id;
  }

  async function record(state: OpsStepState) {
    if (!activeStep || busy) return;
    setBusy(true);
    setError(null);

    const id = await ensureSession();
    if (!id) {
      setBusy(false);
      return;
    }

    const payload: Record<string, unknown> =
      state === "done" && activeStep.input.kind === "number" && numberValue.trim() !== ""
        ? {
            value: Number(numberValue),
            // Record provenance only when the suggested value was accepted unchanged.
            ...(activePrefill && Number(numberValue) === activePrefill.value && activePrefill.source
              ? { source: activePrefill.source }
              : {}),
            // V18 A1: persist what "expected" was shown at the moment of counting.
            ...(typeof activeContext?.expectedPence === "number" ? { expected_pence: activeContext.expectedPence } : {}),
          }
        : {};

    const res = dryRun.active ? { ok: true as const, message: "Practice only." } : await recordChecklistStep({
      sessionId: id,
      stepKey: activeStep.key,
      state,
      payload,
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${activeStep.key}-${Date.now()}`,
      executionContext: LIVE_EXECUTION_CONTEXT,
    });

    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }

    setStates((prev) => ({ ...prev, [activeStep.key]: { state, payload } }));
    setNumberValue("");

    // V18 B2: the DB step insert creates the deduped owner alert in this same
    // transaction (and a critical alert atomically creates outbox debt). No
    // second, crash-prone server write is needed here.

    setBusy(false);
  }

  // F8: required readings are numeric (fridge temperature, till counts). Any that
  // wasn't actually entered ("Not now" / "tell the owner") blocks finishing, with
  // a calm explanation and a one-tap way to go back and do it.
  const readingBlockers = steps.filter(
    (step) => step.input.kind === "number" && states[step.key] && states[step.key].state !== "done",
  );

  function redoStep(key: string) {
    setError(null);
    setStates((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function finish() {
    if ((!sessionId && !dryRun.active) || busy) return;
    if (readingBlockers.length > 0) {
      setError("i18n:checklist.readingNeeded");
      return;
    }
    setBusy(true);
    setError(null);
    const res = dryRun.active ? { ok: true as const, message: "Practice only." } : await completeChecklist({ sessionId: sessionId!, executionContext: LIVE_EXECUTION_CONTEXT });
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
  }

  return (
    <div data-testid="operator-checklist">
      <Link
        href="/operator"
        className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]"
      >
        <ArrowLeft className="operator-directional-icon h-6 w-6" aria-hidden />
        {t("common.back")}
      </Link>

      <Dots total={steps.length} done={handledCount} />

      {activeStep ? (
        <div
          className="mt-5 rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm"
          data-testid="operator-step"
        >
          <h2 className="font-display text-2xl font-semibold leading-tight tracking-[-0.01em]">
            {activeTitle}
          </h2>
          <p className="mt-2 text-base leading-7 text-[var(--muted)]">{activeWhy}</p>

          {activeStep.input.kind === "number" && activeContext ? (
            <div
              className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"
              data-testid="operator-step-money-context"
            >
              <p className="text-lg font-semibold text-[var(--ink)]">{activeContext.heading}</p>
              {(activeContext.lines ?? []).map((line) => (
                <p key={line} className="mt-1 text-base text-[var(--muted)]">
                  {line}
                </p>
              ))}
            </div>
          ) : null}

          {activeStep.input.kind === "number" && (
            <label className="mt-5 block">
              <span className="text-base font-semibold">
                {t(`checklist.${kind}.${activeStep.key}.label` as OperatorTranslationKey)}
              </span>
              {activePrefill ? (
                <span className="mt-1 block text-base font-semibold text-[var(--brand)]" data-testid="operator-step-prefill-hint">
                  {t("checklist.floatHint", { amount: operatorMoney(activePrefill.value, locale) })}
                </span>
              ) : null}
              <span className="mt-2 flex items-center gap-3">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={numberValue}
                  onChange={(event) => setNumberValue(event.target.value)}
                  data-testid="operator-step-number"
                  data-tutorial={
                    kind === "opening" && activeStep.key === "fridge_temp" ? "open-temperature" :
                    kind === "opening" && activeStep.key === "float_ready" ? "open-float" :
                    kind === "closing" && activeStep.key === "cash_counted" ? "close-till" :
                    kind === "closing" && activeStep.key === "fridges_closed" ? "close-temperature" : undefined
                  }
                  className="h-16 w-40 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-2xl font-semibold outline-none focus:border-[var(--brand)]"
                />
                <bdi dir="ltr" className="operator-bidi text-2xl font-semibold text-[var(--muted)]">{activeStep.input.unit}</bdi>
              </span>
            </label>
          )}

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={() => record("done")}
              disabled={busy || (activeStep.input.kind === "number" && numberValue.trim() === "")}
              data-testid="operator-step-yes"
              data-tutorial={
                kind === "opening" && activeStep.key === "display_ready" ? "open-checklist" :
                kind === "closing" && activeStep.key === "clean_done" ? "close-checklist" : undefined
              }
              className="flex min-h-[72px] w-full items-center justify-center gap-3 rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
            >
              <Check className="h-7 w-7" aria-hidden />
              {activeStep.input.kind === "number" ? t("common.save") : t("checklist.yesDone")}
            </button>
            <button
              type="button"
              onClick={() => record("skipped")}
              disabled={busy}
              data-testid="operator-step-skip"
              className="flex min-h-[64px] w-full items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-6 text-lg font-semibold text-[var(--muted)] transition active:scale-[0.99] disabled:opacity-50"
            >
              {activeStep.critical ? t("checklist.cannot") : t("checklist.notNow")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 text-center shadow-sm">
          {readingBlockers.length > 0 ? (
            <div data-testid="operator-checklist-blocked">
              <p className="text-lg font-semibold text-[var(--clay)]">
                {t("checklist.almost")}
              </p>
              <p className="mt-2 text-base text-[var(--muted)]">
                {t(kind === "opening" ? "checklist.blockedOpen" : "checklist.blockedClose")}
              </p>
              <div className="mt-5 grid gap-3">
                {readingBlockers.map((step) => (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => redoStep(step.key)}
                    className="flex min-h-[64px] w-full items-center justify-center rounded-2xl border-2 border-[var(--brand)] bg-[var(--brand-50)] px-6 text-lg font-semibold text-[var(--brand-700)] transition active:scale-[0.99]"
                  >
                    {t("checklist.enter", {
                      step: t(`checklist.${kind}.${step.key}.title` as OperatorTranslationKey),
                    })}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <p className="text-lg font-semibold">{t("checklist.allChecked")}</p>
              <button
                type="button"
                onClick={finish}
                disabled={busy}
                data-testid="operator-checklist-finish"
                data-tutorial={kind === "opening" ? "open-confirm" : "close-confirm"}
                className="mt-5 flex min-h-[72px] w-full items-center justify-center gap-3 rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
              >
                <Check className="h-7 w-7" aria-hidden />
                {t(kind === "opening" ? "checklist.finishOpen" : "checklist.finishClose")}
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p
          className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]"
          data-testid="operator-checklist-error"
          role="alert"
        >
          {operatorError(error)}
        </p>
      )}
    </div>
  );
}

function Dots({ total, done }: { total: number; done: number }) {
  const { t } = useOperatorI18n();
  return (
    <div className="flex items-center gap-2" aria-label={t("checklist.stepProgress", { current: Math.min(done + 1, total), total })}>
      {Array.from({ length: total }).map((_, index) => (
        <span
          key={index}
          className={[
            "h-3 flex-1 rounded-full",
            index < done ? "bg-[var(--brand)]" : "bg-[var(--line)]",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

function Finished({ kind }: { kind: Kind }) {
  const { t } = useOperatorI18n();
  return (
    <section
      className="rounded-2xl border border-[var(--brand)] bg-[var(--brand-50)] p-8 text-center shadow-sm"
      data-testid="operator-checklist-done"
    >
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
        <CheckCircle2 className="h-9 w-9" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-3xl font-semibold tracking-[-0.01em]">
        {t(kind === "opening" ? "checklist.openDone" : "checklist.closeDone")}
      </h2>
      <p className="mt-2 text-lg text-[var(--muted)]">
        {t(kind === "opening" ? "checklist.openDoneHelp" : "checklist.closeDoneHelp")}
      </p>
      <Link
        href="/operator"
        className="mt-6 flex min-h-[64px] w-full items-center justify-center rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99]"
      >
        {t("common.backHome")}
      </Link>
    </section>
  );
}

function buildMoneyContexts(
  picture: MoneyPictureInput | null | undefined,
  t: ReturnType<typeof useOperatorI18n>["t"],
  locale: ReturnType<typeof useOperatorI18n>["locale"],
): Record<string, NumberContext> {
  if (!picture) return {};

  const cashLines: string[] = [];
  if (picture.tillMovements.length > 0) {
    cashLines.push(t("money.movedToday"));
    for (const movement of picture.tillMovements) {
      const sign = movement.signedAmountPence >= 0 ? "+" : "−";
      const reason = movement.reasonCode === "other" && movement.note
        ? movement.note
        : t(`money.movement.${movement.reasonCode}` as OperatorTranslationKey);
      cashLines.push(`${sign}${operatorMoney(Math.abs(movement.signedAmountPence) / 100, locale)} — ${reason}`);
    }
  }

  const missing = picture.ordersMissingTender.length;
  if (missing > 0) {
    cashLines.push(t(missing === 1 ? "money.missingPayment.one" : "money.missingPayment.many", { count: missing }));
  }

  return {
    cash_counted: {
      heading: picture.expectedCashPence === null
        ? t("money.expectedUnknown")
        : t("money.expectedTill", { amount: operatorMoney(picture.expectedCashPence / 100, locale) }),
      lines: cashLines,
      expectedPence: picture.expectedCashPence,
    },
    terminal_total: {
      heading: t("money.cardExpected", { amount: operatorMoney(picture.expectedCardPence / 100, locale) }),
      lines: missing > 0 ? [t("money.cardMayDiffer")] : [],
      expectedPence: picture.expectedCardPence,
    },
  };
}
