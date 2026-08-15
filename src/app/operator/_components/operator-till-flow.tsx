"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";

import { recordTillMovement, type TillReasonCode } from "@/app/actions/operator/till";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import { operatorMoney, type OperatorTranslationKey } from "@/lib/operator/i18n/resources";

// V18 A1 — guided "Till money in / out" (decision D-9). One question at a time,
// big targets, no admin concepts. In or out → how much → what for → confirm.

type Mode = "direction" | "amount" | "reason" | "confirm" | "done";

const IN_REASONS: TillReasonCode[] = ["change", "other"];

const OUT_REASONS: TillReasonCode[] = ["supplier", "owner", "other"];

export function OperatorTillFlow() {
  const { t, error: operatorError, locale } = useOperatorI18n();
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("direction");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<TillReasonCode>("change");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  function restart() {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setMode("direction");
    setDirection("in");
    setAmount("");
    setReason("change");
    setNote("");
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await recordTillMovement({
        runId,
        direction,
        amountGbp: Number(amount),
        reasonCode: reason,
        note: note.trim() === "" ? null : note.trim(),
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMode("done");
    });
  }

  const reasons = direction === "in" ? IN_REASONS : OUT_REASONS;
  const reasonLabel = t(`till.reason.${reason}` as OperatorTranslationKey);

  return (
    <div data-testid="operator-till-flow">
      <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
        <ArrowLeft className="operator-directional-icon h-6 w-6" aria-hidden />
        {t("common.back")}
      </Link>

      {mode === "direction" && (
        <Panel title={t("till.direction")}>
          <BigButton
            onClick={() => {
              setDirection("in");
              setReason("change");
              setMode("amount");
            }}
            label={t("till.in")}
          />
          <BigButton
            onClick={() => {
              setDirection("out");
              setReason("supplier");
              setMode("amount");
            }}
            label={t("till.out")}
          />
        </Panel>
      )}

      {mode === "amount" && (
        <Panel title={t("till.howMuch")} helper={t(direction === "in" ? "till.inHelper" : "till.outHelper")}>
          <label className="block">
            <span className="sr-only">{t("common.amount")}</span>
            <span className="flex items-center gap-3">
              <bdi dir="ltr" className="operator-bidi text-3xl font-semibold text-[var(--muted)]">£</bdi>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                data-testid="operator-till-amount"
                className="h-20 w-44 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-3xl font-semibold outline-none focus:border-[var(--brand)]"
              />
            </span>
          </label>
          <BigButton onClick={() => setMode("reason")} label={t("common.next")} disabled={!(Number(amount) > 0)} />
        </Panel>
      )}

      {mode === "reason" && (
        <Panel title={t("till.reason")}>
          {reasons.map((choice) => (
            <BigButton
              key={choice}
              onClick={() => {
                setReason(choice);
                setMode("confirm");
              }}
              label={t(`till.reason.${choice}` as OperatorTranslationKey)}
              muted={choice === "other"}
            />
          ))}
        </Panel>
      )}

      {mode === "confirm" && (
        <Panel title={t("till.confirm")}>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4">
            <p className="text-lg font-semibold text-[var(--ink)]">
              {t(direction === "in" ? "till.in" : "till.out")}: {operatorMoney(Number(amount || 0), locale)}
            </p>
            <p className="text-lg font-semibold text-[var(--ink)]">{reasonLabel}</p>
          </div>
          {reason === "other" ? (
            <label className="block">
              <span className="text-base font-semibold">{t("till.note")}</span>
              <input
                type="text"
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
                data-testid="operator-till-note"
                className="mt-2 h-16 w-full rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-xl font-semibold outline-none focus:border-[var(--brand)]"
              />
            </label>
          ) : null}
          <BigButton onClick={save} label={t("common.save")} busy={isPending || !runId} />
          <BigButton onClick={() => setMode("reason")} label={t("common.change")} muted />
        </Panel>
      )}

      {mode === "done" && (
        <Panel title={t("common.savedPeriod")}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          <BigButton onClick={restart} label={t("till.another")} />
          <Link
            href="/operator"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            {t("common.backHome")}
          </Link>
        </Panel>
      )}

      {error ? (
        <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]" role="alert">
          {operatorError(error)}
        </p>
      ) : null}
    </div>
  );
}

function Panel({ title, helper, children }: { title: string; helper?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm">
      <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
      {helper ? <p className="mt-2 text-base leading-7 text-[var(--muted)]">{helper}</p> : null}
      <div className="mt-6 grid gap-3">{children}</div>
    </section>
  );
}

function BigButton({ label, onClick, muted, disabled, busy }: { label: string; onClick: () => void; muted?: boolean; disabled?: boolean; busy?: boolean }) {
  const { t } = useOperatorI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={[
        "flex min-h-[72px] w-full items-center justify-center rounded-2xl px-6 text-xl font-semibold transition active:scale-[0.99] disabled:opacity-50",
        muted ? "border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]" : "bg-[var(--brand)] text-white",
      ].join(" ")}
    >
      {busy ? t("common.saving") : label}
    </button>
  );
}
