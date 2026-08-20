"use client";

import { useEffect, useState, useTransition } from "react";

import { recordTillMovement, type TillReasonCode } from "@/app/actions/operator/till";
import { LIVE_EXECUTION_CONTEXT } from "@/lib/operator/execution-context";
import { Button } from "@/components/ui/button";
import { buildCloseMoneyContexts, tillMovementLine, type MoneyPictureInput } from "@/lib/ops-capture/money-context";

// V18 A1 (PTM-OPS-001 / D-9): the manager's view of today's money — expected
// cash and card so far, the day's recorded drawer movements, and a compact
// "Till money in / out" form. Same RPC and rules as the operator flow.

export function AdminTillPanel({ picture }: { picture: MoneyPictureInput | null }) {
  const [runId, setRunId] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<TillReasonCode>("supplier");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  const contexts = buildCloseMoneyContexts(picture);
  const cash = contexts.cash_counted;
  const card = contexts.terminal_total;

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await recordTillMovement({
        runId,
        direction,
        amountGbp: Number(amount),
        reasonCode: reason,
        note: note.trim() === "" ? null : note.trim(),
        executionContext: LIVE_EXECUTION_CONTEXT,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage("Saved. It will show in today's expected cash.");
      setAmount("");
      setNote("");
      setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    });
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-white p-4" data-testid="admin-till-panel">
      <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">Today&rsquo;s money</h2>

      {cash ? (
        <div className="mt-2 space-y-1 text-sm text-[#5c5148]">
          <p className="font-bold text-[var(--ink)]">{cash.heading}</p>
          {card ? <p className="font-bold text-[var(--ink)]">{card.heading}</p> : null}
          {(picture?.tillMovements ?? []).map((movement, index) => (
            <p key={index}>{tillMovementLine(movement)}</p>
          ))}
          {(cash.lines ?? [])
            .filter((line) => line.includes("no payment recorded"))
            .map((line) => (
              <p key={line} className="font-semibold text-[#7a4b00]">
                {line}
              </p>
            ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-[#5c5148]">No money picture yet today.</p>
      )}

      <div className="mt-4 grid gap-2 border-t border-[var(--line)] pt-4">
        <p className="text-sm font-bold text-[var(--ink)]">Till money in / out</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={direction === "in" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDirection("in");
              setReason("change");
            }}
          >
            Money in
          </Button>
          <Button
            type="button"
            variant={direction === "out" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDirection("out");
              setReason("supplier");
            }}
          >
            Money out
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm font-bold">
            £
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="admin-till-amount"
              className="h-10 w-28 rounded-lg border border-[var(--line)] bg-[#fbfaf7] px-3 text-base font-bold outline-none focus:border-[var(--brand)]"
            />
          </label>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as TillReasonCode)}
            className="h-10 rounded-lg border border-[var(--line)] bg-[#fbfaf7] px-2 text-sm font-semibold"
            data-testid="admin-till-reason"
          >
            {direction === "in" ? <option value="change">Change added</option> : null}
            {direction === "out" ? <option value="supplier">Paid a supplier</option> : null}
            {direction === "out" ? <option value="owner">Owner took cash</option> : null}
            <option value="other">Other</option>
          </select>
          <input
            type="text"
            value={note}
            maxLength={200}
            placeholder="Note (optional)"
            onChange={(event) => setNote(event.target.value)}
            className="h-10 min-w-[10rem] flex-1 rounded-lg border border-[var(--line)] bg-[#fbfaf7] px-3 text-sm"
          />
          <Button type="button" size="sm" disabled={isPending || !(Number(amount) > 0)} onClick={save}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
        {message ? <p className="text-sm font-semibold text-[var(--brand)]">{message}</p> : null}
        {error ? (
          <p className="text-sm font-semibold text-[#9f1d1d]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
