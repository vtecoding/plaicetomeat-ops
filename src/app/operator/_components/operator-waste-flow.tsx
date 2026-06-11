"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";

import { recordNoWaste, recordSimpleWaste } from "@/app/actions/operator/waste";
import { WASTE_REASON_CHOICES, type WasteReasonChoice } from "@/lib/operator/workflows/waste";

type ProductOption = { id: string; name: string; unitType: string };
type Mode = "start" | "product" | "amount" | "reason" | "photo" | "confirm" | "done";

export function OperatorWasteFlow({ products }: { products: ProductOption[] }) {
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("start");
  const [productId, setProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<WasteReasonChoice>("expired");
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  const product = useMemo(() => products.find((item) => item.id === productId) ?? null, [products, productId]);
  const unit = product?.unitType ?? "kg";

  function restart() {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setMode("start");
    setProductId(null);
    setQuantity("");
    setReason("expired");
    setPhotoName(null);
    setResult(null);
    setError(null);
  }

  function saveNoWaste() {
    setError(null);
    startTransition(async () => {
      const res = await recordNoWaste({ runId });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.message);
      setMode("done");
    });
  }

  function saveWaste() {
    setError(null);
    startTransition(async () => {
      const res = await recordSimpleWaste({
        runId,
        productId,
        quantity: Number(quantity),
        reason,
        photoName,
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
    <div data-testid="operator-waste-flow">
      <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
        <ArrowLeft className="h-6 w-6" aria-hidden />
        Back
      </Link>

      {mode === "start" && (
        <Panel title="Did you throw anything away?">
          <BigButton onClick={() => setMode("product")} label="Yes" />
          <BigButton onClick={saveNoWaste} label="No" muted busy={isPending || !runId} />
        </Panel>
      )}

      {mode === "product" && (
        <Panel title="What was thrown away?">
          <ProductGrid products={products} onPick={(id) => { setProductId(id); setMode("amount"); }} />
          <BigButton onClick={() => { setProductId(null); setMode("amount"); }} label="Not sure" muted />
        </Panel>
      )}

      {mode === "amount" && (
        <Panel title="How much?" helper={product ? product.name : "If you are not sure, enter your best guess."}>
          <AmountInput value={quantity} onChange={setQuantity} unit={unit} />
          <BigButton onClick={() => setMode("reason")} label="Next" disabled={Number(quantity) <= 0} />
        </Panel>
      )}

      {mode === "reason" && (
        <Panel title="Why?">
          {WASTE_REASON_CHOICES.map((choice) => (
            <BigButton key={choice.id} onClick={() => { setReason(choice.id); setMode("photo"); }} label={choice.label} muted={choice.id === "review"} />
          ))}
        </Panel>
      )}

      {mode === "photo" && (
        <Panel title="Take a photo?" helper="This is optional.">
          <label className="flex min-h-[72px] cursor-pointer items-center justify-center rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99]">
            Take or choose photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                setPhotoName(event.target.files?.[0]?.name ?? null);
                setMode("confirm");
              }}
            />
          </label>
          <BigButton onClick={() => { setPhotoName(null); setMode("confirm"); }} label="Skip for now" muted />
          {photoName ? <p className="text-base font-semibold text-[var(--muted)]">Chosen: {photoName}</p> : null}
        </Panel>
      )}

      {mode === "confirm" && (
        <Panel title="Save this waste?">
          <Summary
            lines={[
              product?.name ?? "Product: not sure",
              `${quantity || "0"} ${unit}`,
              WASTE_REASON_CHOICES.find((choice) => choice.id === reason)?.label ?? "Other / not sure",
            ]}
          />
          <BigButton onClick={saveWaste} label="Save this waste" busy={isPending || !runId} />
        </Panel>
      )}

      {mode === "done" && (
        <Panel title={result ?? "Saved"}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          <BigButton onClick={restart} label="Record another" />
          <Link
            href="/operator"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            Back to home
          </Link>
        </Panel>
      )}

      {error ? <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]">{error}</p> : null}
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

function ProductGrid({ products, onPick }: { products: ProductOption[]; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {products.slice(0, 12).map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onPick(product.id)}
          className="min-h-[88px] rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-left text-xl font-semibold text-[var(--ink)] transition active:scale-[0.99]"
        >
          {product.name}
        </button>
      ))}
    </div>
  );
}

function AmountInput({ value, onChange, unit }: { value: string; onChange: (value: string) => void; unit: string }) {
  return (
    <label className="block">
      <span className="sr-only">Amount</span>
      <span className="flex items-center gap-3">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-testid="operator-waste-quantity"
          className="h-20 w-44 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-3xl font-semibold outline-none focus:border-[var(--brand)]"
        />
        <span className="text-2xl font-semibold text-[var(--muted)]">{unit}</span>
      </span>
    </label>
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
