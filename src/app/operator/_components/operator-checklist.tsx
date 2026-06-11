"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2 } from "lucide-react";

import {
  completeChecklist,
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
}: {
  branchId: string;
  kind: Kind;
  initialSessionId: string | null;
  initialSummary: ChecklistSummary;
  initialReceipt: ChecklistReceipt | null;
}) {
  const definition = useMemo(() => getChecklist(kind), [kind]);
  const steps = definition.steps;

  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [states, setStates] = useState<Record<string, StepRecord>>(() => seedStates(initialSummary));
  const [numberValue, setNumberValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean>(initialReceipt !== null);

  if (done) {
    return <Finished kind={kind} />;
  }

  const activeIndex = steps.findIndex((step) => !states[step.key]);
  const allHandled = activeIndex === -1;
  const activeStep = allHandled ? null : steps[activeIndex];
  const handledCount = Object.keys(states).length;

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
        ? { value: Number(numberValue) }
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
    setBusy(false);
  }

  async function finish() {
    if (!sessionId || busy) return;
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
