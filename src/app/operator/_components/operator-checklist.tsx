"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2 } from "lucide-react";

import {
  completeChecklist,
  escalateChecklistStep,
  recordChecklistStep,
  startOrResumeChecklist,
} from "@/app/actions/ops-capture";
import { getChecklist } from "@/lib/ops-capture/checklists";
import type { ChecklistReceipt, ChecklistSummary, OpsStepState } from "@/lib/ops-capture/types";

// V17 Phase 2 — the operator-friendly face of the EXISTING opening/closing ritual.
//
// This is NOT a second checklist: it renders the same step definitions and calls
// the same ops-capture server actions (start / record / complete) as the owner's
// GuidedChecklist, so it produces byte-identical backend records (sessions, step
// events, completion). It only changes the skin: one big question at a time, big
// Yes / Not yet buttons, dot progress (never a number bar), and plain reassurance.

type StepRecord = { state: OpsStepState; payload: Record<string, unknown> };
type Kind = "opening" | "closing";

/** A suggested value for a number step, drawn from history, that the operator confirms. */
export type NumberPrefill = { value: number; hint: string; source: string | null };

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
}: {
  branchId: string;
  kind: Kind;
  initialSessionId: string | null;
  initialSummary: ChecklistSummary;
  initialReceipt: ChecklistReceipt | null;
  numberPrefills?: Record<string, NumberPrefill>;
}) {
  const definition = useMemo(() => getChecklist(kind), [kind]);
  const steps = definition.steps;

  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [states, setStates] = useState<Record<string, StepRecord>>(() => seedStates(initialSummary));
  const [numberValue, setNumberValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean>(initialReceipt !== null);

  const activeIndex = steps.findIndex((step) => !states[step.key]);
  const allHandled = activeIndex === -1;
  const activeStep = done || allHandled ? null : steps[activeIndex];
  const handledCount = Object.keys(states).length;

  const activePrefill = activeStep ? numberPrefills?.[activeStep.key] : undefined;

  // Seed the number field with a suggested value when a prefilled step opens (e.g. the
  // opening float). The operator can edit it before saving, so nothing is silently kept.
  useEffect(() => {
    setNumberValue(activePrefill ? String(activePrefill.value) : "");
  }, [activeStep?.key, activePrefill]);

  if (done) {
    return <Finished kind={kind} />;
  }

  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    const res = await startOrResumeChecklist({ branchId, kind });
    if (!res.ok || !res.id) {
      setError(res.ok ? "Could not start. Please try again." : res.message);
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
          }
        : {};

    const res = await recordChecklistStep({
      sessionId: id,
      stepKey: activeStep.key,
      state,
      payload,
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${activeStep.key}-${Date.now()}`,
    });

    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }

    setStates((prev) => ({ ...prev, [activeStep.key]: { state, payload } }));
    setNumberValue("");

    // F8: a critical step the operator can't do raises an owner escalation. The
    // step is NOT counted as done — a required reading still blocks completion.
    if (state === "skipped" && activeStep.critical) {
      await escalateChecklistStep({
        branchId,
        kind,
        stepKey: activeStep.key,
        stepTitle: activeStep.title,
      });
    }

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
    if (!sessionId || busy) return;
    if (readingBlockers.length > 0) {
      setError("A temperature or till reading is still needed before this can be finished. Ask owner if unsure.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await completeChecklist({ sessionId });
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
        <ArrowLeft className="h-6 w-6" aria-hidden />
        Back
      </Link>

      <Dots total={steps.length} done={handledCount} />

      {activeStep ? (
        <div
          className="mt-5 rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm"
          data-testid="operator-step"
        >
          <h2 className="font-display text-2xl font-semibold leading-tight tracking-[-0.01em]">
            {activeStep.title}
          </h2>
          <p className="mt-2 text-base leading-7 text-[var(--muted)]">{activeStep.why}</p>

          {activeStep.input.kind === "number" && (
            <label className="mt-5 block">
              <span className="text-base font-semibold">{activeStep.input.label}</span>
              {activePrefill ? (
                <span className="mt-1 block text-base font-semibold text-[var(--brand)]" data-testid="operator-step-prefill-hint">
                  {activePrefill.hint}
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
                  className="h-16 w-40 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-2xl font-semibold outline-none focus:border-[var(--brand)]"
                />
                <span className="text-2xl font-semibold text-[var(--muted)]">{activeStep.input.unit}</span>
              </span>
            </label>
          )}

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={() => record("done")}
              disabled={busy || (activeStep.input.kind === "number" && numberValue.trim() === "")}
              data-testid="operator-step-yes"
              className="flex min-h-[72px] w-full items-center justify-center gap-3 rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
            >
              <Check className="h-7 w-7" aria-hidden />
              {activeStep.input.kind === "number" ? "Save" : "Yes, done"}
            </button>
            <button
              type="button"
              onClick={() => record("skipped")}
              disabled={busy}
              data-testid="operator-step-skip"
              className="flex min-h-[64px] w-full items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-6 text-lg font-semibold text-[var(--muted)] transition active:scale-[0.99] disabled:opacity-50"
            >
              {activeStep.critical ? "I can't do this — tell the owner" : "Not now"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 text-center shadow-sm">
          {readingBlockers.length > 0 ? (
            <div data-testid="operator-checklist-blocked">
              <p className="text-lg font-semibold text-[var(--clay)]">
                Almost there — a reading is still needed.
              </p>
              <p className="mt-2 text-base text-[var(--muted)]">
                {kind === "opening" ? "The shop can&rsquo;t open" : "The shop can&rsquo;t close"} until these are entered. Ask owner if unsure.
              </p>
              <div className="mt-5 grid gap-3">
                {readingBlockers.map((step) => (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => redoStep(step.key)}
                    className="flex min-h-[64px] w-full items-center justify-center rounded-2xl border-2 border-[var(--brand)] bg-[var(--brand-50)] px-6 text-lg font-semibold text-[var(--brand-700)] transition active:scale-[0.99]"
                  >
                    Enter: {step.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <p className="text-lg font-semibold">That&rsquo;s everything checked.</p>
              <button
                type="button"
                onClick={finish}
                disabled={busy}
                data-testid="operator-checklist-finish"
                className="mt-5 flex min-h-[72px] w-full items-center justify-center gap-3 rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
              >
                <Check className="h-7 w-7" aria-hidden />
                {kind === "opening" ? "Open the shop" : "Close the shop"}
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
          {error}
        </p>
      )}
    </div>
  );
}

function Dots({ total, done }: { total: number; done: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${Math.min(done + 1, total)} of ${total}`}>
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
  return (
    <section
      className="rounded-2xl border border-[var(--brand)] bg-[var(--brand-50)] p-8 text-center shadow-sm"
      data-testid="operator-checklist-done"
    >
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
        <CheckCircle2 className="h-9 w-9" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-3xl font-semibold tracking-[-0.01em]">
        {kind === "opening" ? "The shop is open" : "The shop is closed"}
      </h2>
      <p className="mt-2 text-lg text-[var(--muted)]">
        {kind === "opening" ? "Have a good day." : "All saved. Well done today."}
      </p>
      <Link
        href="/operator"
        className="mt-6 flex min-h-[64px] w-full items-center justify-center rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99]"
      >
        Back to home
      </Link>
    </section>
  );
}
