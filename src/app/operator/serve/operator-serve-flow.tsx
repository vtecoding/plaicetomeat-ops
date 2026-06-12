"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingBag } from "lucide-react";

import { saveSimpleSale } from "@/app/actions/operator/serve";
import { SERVE_AMOUNT_CHOICES, type ServeTile } from "@/lib/operator/workflows/serve";

type Line = {
  key: string;
  productId: string | null;
  name: string;
  quantityKg: number;
  label: string;
};

type Mode = "buy" | "other-name" | "amount" | "other-amount" | "add-more" | "pay" | "confirm" | "done";
type PayKind = "cash" | "card";

export function OperatorServeFlow({ tiles }: { tiles: ServeTile[] }) {
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("buy");
  const [picked, setPicked] = useState<ServeTile | null>(null);
  const [otherName, setOtherName] = useState("");
  const [grams, setGrams] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [payKind, setPayKind] = useState<PayKind>("cash");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  const summary = useMemo(() => lines.map((line) => `${line.name} ${line.label}`), [lines]);

  function restart() {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setMode("buy");
    setPicked(null);
    setOtherName("");
    setGrams("");
    setLines([]);
    setPayKind("cash");
    setResult(null);
    setError(null);
  }

  function choose(tile: ServeTile) {
    setPicked(tile);
    setOtherName(tile.id === "other" ? "" : tile.fallbackName);
    setMode(tile.id === "other" ? "other-name" : "amount");
  }

  function addLine(quantityKg: number, label: string) {
    const name = picked?.productId ? picked.label : otherName.trim() || picked?.fallbackName || "Other";
    setLines((items) => [
      ...items,
      {
        key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        productId: picked?.productId ?? null,
        name,
        quantityKg,
        label,
      },
    ]);
    setPicked(null);
    setOtherName("");
    setGrams("");
    setMode("add-more");
  }

  function addOtherAmount() {
    const value = Number(grams);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Try again.");
      return;
    }
    setError(null);
    addLine(value / 1000, `${value}g`);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveSimpleSale({
        runId,
        lines: lines.map((line) => ({ productId: line.productId, name: line.name, quantityKg: line.quantityKg })),
        payKind,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.message);
      setMode("done");
    });
  }

  return (
    <div data-testid="operator-serve-flow">
      <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
        <ArrowLeft className="h-6 w-6" aria-hidden />
        Go back
      </Link>

      {mode === "buy" && (
        <Panel title="What did they buy?">
          <div className="grid gap-3 sm:grid-cols-2">
            {tiles.map((tile) => (
              <BigButton key={tile.id} onClick={() => choose(tile)} label={tile.label} muted={!tile.productId && tile.id !== "other"} />
            ))}
          </div>
        </Panel>
      )}

      {mode === "other-name" && (
        <Panel title="What is it called?">
          <input
            value={otherName}
            onChange={(event) => setOtherName(event.target.value)}
            autoFocus
            maxLength={80}
            className="h-20 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-2xl font-semibold outline-none focus:border-[var(--brand)]"
          />
          <BigButton onClick={() => setMode("amount")} label="Next" disabled={otherName.trim().length < 2} />
        </Panel>
      )}

      {mode === "amount" && (
        <Panel title="How much?">
          {SERVE_AMOUNT_CHOICES.map((choice) => (
            <BigButton key={choice.id} onClick={() => addLine(choice.kg, choice.label)} label={choice.label} />
          ))}
          <BigButton onClick={() => setMode("other-amount")} label="Other amount" muted />
        </Panel>
      )}

      {mode === "other-amount" && (
        <Panel title="How much?">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-center text-4xl font-semibold">
            {grams || "0"}g
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00"].map((digit) => (
              <BigButton key={digit} onClick={() => setGrams((value) => `${value}${digit}`.slice(0, 5))} label={digit} />
            ))}
            <BigButton onClick={() => setGrams("")} label="Clear" muted />
          </div>
          <BigButton onClick={addOtherAmount} label="Next" disabled={Number(grams) <= 0} />
        </Panel>
      )}

      {mode === "add-more" && (
        <Panel title="Add more?">
          <Summary lines={summary} />
          <BigButton onClick={() => setMode("buy")} label="Yes" />
          <BigButton onClick={() => setMode("pay")} label="No" muted />
        </Panel>
      )}

      {mode === "pay" && (
        <Panel title="How did they pay?">
          <BigButton onClick={() => { setPayKind("cash"); setMode("confirm"); }} label="Cash" />
          <BigButton onClick={() => { setPayKind("card"); setMode("confirm"); }} label="Card" />
        </Panel>
      )}

      {mode === "confirm" && (
        <Panel title="Save this sale?">
          <Summary lines={[...summary, `Paid by ${payKind}`]} />
          <BigButton onClick={save} label="Save" busy={isPending || !runId} />
          <BigButton onClick={() => setMode("pay")} label="Go back" muted />
        </Panel>
      )}

      {mode === "done" && (
        <Panel title="Done">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          {result ? <p className="text-center text-lg font-semibold text-[var(--muted)]">{result}</p> : null}
          <BigButton onClick={restart} label="Serve next person" />
          <Link
            href="/operator"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            Go home
          </Link>
        </Panel>
      )}

      {error ? <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]">{error}</p> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <ShoppingBag className="mt-1 h-8 w-8 shrink-0 text-[var(--brand)]" aria-hidden />
        <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
      </div>
      <div className="mt-6 grid gap-3">{children}</div>
    </section>
  );
}

function BigButton({ label, onClick, muted, disabled, busy }: { label: string; onClick: () => void; muted?: boolean; disabled?: boolean; busy?: boolean }) {
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
      {busy ? "Saving..." : label}
    </button>
  );
}

function Summary({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4">
      {lines.map((line) => (
        <p key={line} className="text-lg font-semibold text-[var(--ink)]">
          {line}
        </p>
      ))}
    </div>
  );
}
