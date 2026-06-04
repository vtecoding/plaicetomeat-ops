"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, MinusCircle, ShieldAlert } from "lucide-react";

import {
  completeChecklist,
  recordChecklistStep,
  startOrResumeChecklist,
} from "@/app/actions/ops-capture";
import { getChecklist } from "@/lib/ops-capture/checklists";
import { buildReceipt } from "@/lib/ops-capture/progress";
import type { ChecklistReceipt, ChecklistStepStatus, ChecklistSummary, OpsStepState } from "@/lib/ops-capture/types";
import { cn } from "@/lib/utils";

type StepRecord = { state: OpsStepState; payload: Record<string, unknown> };

function seedStates(summary: ChecklistSummary): Record<string, StepRecord> {
  const out: Record<string, StepRecord> = {};
  for (const step of summary.steps) {
    if (step.state !== null) out[step.def.key] = { state: step.state, payload: step.payload ?? {} };
  }
  return out;
}

export function GuidedChecklist({
  branchId,
  kind,
  initialSessionId,
  initialSummary,
  initialReceipt,
}: {
  branchId: string;
  kind: "opening" | "closing";
  initialSessionId: string | null;
  initialSummary: ChecklistSummary;
  initialReceipt: ChecklistReceipt | null;
}) {
  const definition = useMemo(() => getChecklist(kind), [kind]);

  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [states, setStates] = useState<Record<string, StepRecord>>(() => seedStates(initialSummary));
  const [numberValue, setNumberValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ChecklistReceipt | null>(initialReceipt);

  if (receipt) {
    return <Receipt receipt={receipt} kind={kind} />;
  }

  const steps = definition.steps;
  const activeIndex = steps.findIndex((step) => !states[step.key]);
  const allHandled = activeIndex === -1;
  const handledCount = Object.keys(states).length;
  const activeStep = allHandled ? null : steps[activeIndex];

  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    const res = await startOrResumeChecklist({ branchId, kind });
    if (!res.ok || !res.id) {
      setError(res.ok ? "Could not start this checklist." : res.message);
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

    // Build the receipt from what we just recorded — identical to the persisted one.
    const events = steps
      .filter((step) => states[step.key])
      .map((step, i) => ({
        id: `${step.key}-${i}`,
        stepKey: step.key,
        state: states[step.key].state,
        payload: states[step.key].payload,
        createdAt: new Date(Date.now() + i).toISOString(),
      }));
    setReceipt(buildReceipt(definition, events, "just now"));
    setBusy(false);
  }

  return (
    <div data-testid="guided-checklist">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/today" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132] hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to today
        </Link>
        <span className="text-sm font-bold text-[#6c5e52]" data-testid="checklist-progress">
          {handledCount} of {steps.length} done
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ece2d5]">
        <div className="h-full rounded-full bg-[#0f5132] transition-all" style={{ width: `${Math.round((handledCount / steps.length) * 100)}%` }} />
      </div>

      <ol className="mt-4 grid gap-3">
        {steps.map((step, index) => {
          const recorded = states[step.key];
          const isActive = index === activeIndex;
          return (
            <li key={step.key}>
              {recorded ? (
                <DoneRow step={{ def: step, state: recorded.state, payload: recorded.payload }} />
              ) : isActive ? (
                <ActiveStep
                  step={step}
                  busy={busy}
                  numberValue={numberValue}
                  onNumber={setNumberValue}
                  onDone={() => record("done")}
                  onSkip={() => record("skipped")}
                />
              ) : (
                <PendingRow title={step.title} critical={step.critical} />
              )}
            </li>
          );
        })}
      </ol>

      {error && <p className="mt-4 rounded-xl border border-[#f5c2c7] bg-[#fff5f5] p-3 text-sm font-semibold text-[#9f1d1d]" data-testid="checklist-error">{error}</p>}

      {allHandled && (
        <button
          type="button"
          onClick={finish}
          disabled={busy}
          data-testid="checklist-finish"
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27] disabled:opacity-50"
        >
          Finish & save
          <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function ActiveStep({
  step,
  busy,
  numberValue,
  onNumber,
  onDone,
  onSkip,
}: {
  step: ReturnType<typeof getChecklist>["steps"][number];
  busy: boolean;
  numberValue: string;
  onNumber: (v: string) => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const needsNumber = step.input.kind === "number";
  const canDone = !busy && (!needsNumber || numberValue.trim() !== "");

  return (
    <div className="rounded-2xl border-2 border-[#0f5132] bg-white p-5 shadow-sm" data-testid="checklist-step-active">
      <div className="flex items-start gap-3">
        <Circle className="mt-0.5 h-6 w-6 shrink-0 text-[#0f5132]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black text-[#241f1a]">{step.title}</h3>
            {step.critical && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4d8] px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.06em] text-[#8b5e00]">
                <ShieldAlert className="h-3 w-3" aria-hidden /> Important
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-[#5c5148]">{step.why}</p>

          {step.input.kind === "number" && (
            <label className="mt-3 block">
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#6c5e52]">{step.input.label}</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={numberValue}
                  onChange={(e) => onNumber(e.target.value)}
                  data-testid="step-number-input"
                  className="h-11 w-32 rounded-xl border border-[#d6cdc0] bg-[#fbfaf7] px-3 text-base font-bold text-[#241f1a] outline-none focus:border-[#0f5132]"
                />
                <span className="text-base font-bold text-[#6c5e52]">{step.input.unit}</span>
              </div>
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onDone}
          disabled={!canDone}
          data-testid="step-done-btn"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#0f5132] px-5 text-base font-bold text-white transition hover:bg-[#0c3f27] disabled:opacity-50"
        >
          <Check className="h-5 w-5" aria-hidden />
          Done
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          data-testid="step-skip-btn"
          className="inline-flex h-11 items-center justify-center rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-5 text-base font-bold text-[#6c5e52] transition hover:bg-[#efe8dd] disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function DoneRow({ step }: { step: ChecklistStepStatus }) {
  const skipped = step.state === "skipped" || step.state === "na";
  const value =
    step.def.input.kind === "number" && step.payload && typeof step.payload.value === "number"
      ? step.def.input.unit === "£"
        ? `£${(step.payload.value as number).toFixed(2)}`
        : `${step.payload.value} ${step.def.input.unit}`
      : null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4" data-testid="checklist-step-done">
      {skipped ? (
        <MinusCircle className="h-5 w-5 shrink-0 text-[#9a8c7d]" aria-hidden />
      ) : (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-[#0f5132]" aria-hidden />
      )}
      <span className={cn("flex-1 text-base font-bold", skipped ? "text-[#6c5e52]" : "text-[#241f1a]")}>{step.def.title}</span>
      {value && <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-black text-[#241f1a] ring-1 ring-[#ece2d5]">{value}</span>}
      {skipped && <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#9a8c7d]">Skipped</span>}
    </div>
  );
}

function PendingRow({ title, critical }: { title: string; critical: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#ece2d5] bg-white/60 p-4 opacity-60">
      <Circle className="h-5 w-5 shrink-0 text-[#cbbfae]" aria-hidden />
      <span className="flex-1 text-base font-semibold text-[#9a8c7d]">{title}</span>
      {critical && <ShieldAlert className="h-4 w-4 text-[#cbbfae]" aria-hidden />}
    </div>
  );
}

function Receipt({ receipt, kind }: { receipt: ChecklistReceipt; kind: "opening" | "closing" }) {
  return (
    <section className="rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-6 shadow-sm" data-testid="checklist-receipt">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-white">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h2 className="text-2xl font-black text-[#0f5132]">{kind === "opening" ? "Shop is ready" : "Shop is closed"}</h2>
          <p className="text-sm font-semibold text-[#27543c]">
            {receipt.handledCount} of {receipt.totalCount} steps · {receipt.completedAtLabel}
          </p>
        </div>
      </div>

      <ul className="mt-4 grid gap-2">
        {receipt.lines.map((line) => {
          const skipped = line.state === "skipped" || line.state === "na";
          return (
            <li key={line.title} className="flex items-center gap-3 rounded-xl bg-white/70 p-3">
              {skipped ? (
                <MinusCircle className="h-4 w-4 shrink-0 text-[#9a8c7d]" aria-hidden />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0f5132]" aria-hidden />
              )}
              <span className={cn("flex-1 text-sm font-semibold", skipped ? "text-[#6c5e52]" : "text-[#241f1a]")}>{line.title}</span>
              {line.detail && <span className="text-xs font-black text-[#0f5132]">{line.detail}</span>}
              {skipped && <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#9a8c7d]">Skipped</span>}
            </li>
          );
        })}
      </ul>

      <Link
        href="/admin/today"
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27]"
      >
        Back to today
      </Link>
    </section>
  );
}
