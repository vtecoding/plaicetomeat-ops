"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Truck } from "lucide-react";

import { confirmSimpleDelivery, reportRanOut, tellOwnerAboutStock } from "@/app/actions/operator/delivery";
import { uploadOperatorEvidence } from "@/app/actions/operator/evidence";
import { EXPIRY_CHOICES, STORAGE_CHOICES, type ExpiryChoice, type StorageChoice } from "@/lib/operator/workflows/stock";

type ProductOption = { id: string; name: string; unitType: string };
type SupplierOption = { id: string; name: string };
type Mode = "start" | "delivery-product" | "delivery-amount" | "delivery-supplier" | "delivery-photo" | "delivery-storage" | "delivery-expiry" | "delivery-confirm" | "ranout-product" | "ranout-sure" | "ranout-confirm" | "done";

export function OperatorStockFlow({ products, suppliers }: { products: ProductOption[]; suppliers: SupplierOption[] }) {
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("start");
  const [productId, setProductId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(suppliers.length === 1 ? suppliers[0]?.id ?? null : null);
  const [quantity, setQuantity] = useState("");
  const [notePhotoName, setNotePhotoName] = useState<string | null>(null);
  const [noteEvidenceId, setNoteEvidenceId] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [storageChoice, setStorageChoice] = useState<StorageChoice>("fridge");
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("tomorrow");
  const [sureRanOut, setSureRanOut] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  const product = useMemo(() => products.find((item) => item.id === productId) ?? null, [products, productId]);
  const supplier = useMemo(() => suppliers.find((item) => item.id === supplierId) ?? null, [suppliers, supplierId]);
  const unit = product?.unitType ?? "kg";

  function restart(next: Mode) {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setMode(next);
    setProductId(null);
    setSupplierId(suppliers.length === 1 ? suppliers[0]?.id ?? null : null);
    setQuantity("");
    setNotePhotoName(null);
    setNoteEvidenceId(null);
    setPhotoSaving(false);
    setStorageChoice("fridge");
    setExpiryChoice("tomorrow");
    setSureRanOut(true);
    setResult(null);
    setError(null);
  }

  function saveDelivery() {
    setError(null);
    startTransition(async () => {
      const res = await confirmSimpleDelivery({
        runId,
        productId,
        supplierId,
        quantity: Number(quantity),
        expiryChoice,
        storageChoice,
        noteEvidenceId,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.message);
      setMode("done");
    });
  }

  function saveRanOut() {
    setError(null);
    startTransition(async () => {
      const res = await reportRanOut({ runId, productId, sure: sureRanOut });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.message);
      setMode("done");
    });
  }

  function askOwner() {
    setError(null);
    startTransition(async () => {
      const res = await tellOwnerAboutStock({ runId });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.message);
      setMode("done");
    });
  }

  async function savePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhotoSaving(true);
    setNotePhotoName(file.name);
    setNoteEvidenceId(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("evidenceType", "delivery_note");
    formData.set("sourceType", "operator_workflow_run");
    formData.set("sourceId", runId);
    formData.set("sourceRef", product?.name ?? "Delivery note");

    const res = await uploadOperatorEvidence(formData);
    setPhotoSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNoteEvidenceId(res.id);
    setNotePhotoName(res.fileName);
    setMode("delivery-storage");
  }

  return (
    <div data-testid="operator-stock-flow">
      <TopLink />

      {mode === "start" && (
        <Panel title="What happened?">
          <BigButton onClick={() => setMode("delivery-product")} label="A delivery arrived" />
          <BigButton onClick={() => setMode("ranout-product")} label="Something ran out" />
          <BigButton onClick={askOwner} label="I am not sure - tell owner" muted busy={isPending} />
          <Link
            href="/operator/waste"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            I threw something away
          </Link>
        </Panel>
      )}

      {mode === "delivery-product" && (
        <Panel title="What arrived?">
          <ProductGrid products={products} onPick={(id) => { setProductId(id); setMode("delivery-amount"); }} />
          <BigButton onClick={() => { setProductId(null); setMode("delivery-amount"); }} label="Something else / not sure" muted />
        </Panel>
      )}

      {mode === "delivery-amount" && (
        <Panel title="How much arrived?" helper={product ? product.name : "If you are not sure, enter your best guess."}>
          <AmountInput value={quantity} onChange={setQuantity} unit={unit} testId="operator-delivery-quantity" />
          <BigButton onClick={() => setMode("delivery-supplier")} label="Next" disabled={Number(quantity) <= 0} />
        </Panel>
      )}

      {mode === "delivery-supplier" && (
        <Panel title="Who brought it?">
          <div className="grid gap-3">
            {suppliers.map((item) => (
              <BigButton key={item.id} onClick={() => { setSupplierId(item.id); setMode("delivery-photo"); }} label={item.name} />
            ))}
            <BigButton onClick={() => { setSupplierId(null); setMode("delivery-photo"); }} label="Not sure" muted />
          </div>
        </Panel>
      )}

      {mode === "delivery-photo" && (
        <Panel title="Photo of the delivery note?" helper="This is optional.">
          <label className="flex min-h-[72px] cursor-pointer items-center justify-center rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99]">
            Take or choose photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={photoSaving || !runId}
              onChange={(event) => void savePhoto(event.target.files?.[0])}
            />
          </label>
          <BigButton onClick={() => { setNotePhotoName(null); setNoteEvidenceId(null); setMode("delivery-storage"); }} label="Skip for now" muted />
          {photoSaving ? <p className="text-base font-semibold text-[var(--muted)]">Saving photo...</p> : null}
          {noteEvidenceId && notePhotoName ? <p className="text-base font-semibold text-[var(--muted)]">Photo saved: {notePhotoName}</p> : null}
        </Panel>
      )}

      {mode === "delivery-storage" && (
        <Panel title="Where did you put it?">
          {STORAGE_CHOICES.map((choice) => (
            <BigButton key={choice.id} onClick={() => { setStorageChoice(choice.id); setMode("delivery-expiry"); }} label={choice.label} muted={choice.id === "not_sure"} />
          ))}
        </Panel>
      )}

      {mode === "delivery-expiry" && (
        <Panel title="When does it go off?">
          {EXPIRY_CHOICES.map((choice) => (
            <BigButton key={choice.id} onClick={() => { setExpiryChoice(choice.id); setMode("delivery-confirm"); }} label={choice.label} muted={choice.id === "not_sure"} />
          ))}
        </Panel>
      )}

      {mode === "delivery-confirm" && (
        <Panel title="Add this delivery?">
          <Summary
            lines={[
              product?.name ?? "Product: not sure",
              `${quantity || "0"} ${unit}`,
              supplier?.name ?? "Supplier: not sure",
              `Location: ${STORAGE_CHOICES.find((choice) => choice.id === storageChoice)?.label ?? "Not sure"}`,
            ]}
          />
          <BigButton onClick={saveDelivery} label="Add this delivery" busy={isPending || !runId} />
        </Panel>
      )}

      {mode === "ranout-product" && (
        <Panel title="What ran out?">
          <ProductGrid products={products} onPick={(id) => { setProductId(id); setMode("ranout-sure"); }} />
          <BigButton onClick={() => { setProductId(null); setMode("ranout-sure"); }} label="Something else / not sure" muted />
        </Panel>
      )}

      {mode === "ranout-sure" && (
        <Panel title="Are you sure it is empty?">
          <BigButton onClick={() => { setSureRanOut(true); setMode("ranout-confirm"); }} label="Yes" />
          <BigButton onClick={() => { setSureRanOut(false); setMode("ranout-confirm"); }} label="Not sure" muted />
        </Panel>
      )}

      {mode === "ranout-confirm" && (
        <Panel title="Tell owner this ran out?">
          <Summary lines={[product?.name ?? "Product: not sure", sureRanOut ? "It is empty" : "Please check it"]} />
          <BigButton onClick={saveRanOut} label="Tell owner" busy={isPending || !runId} />
        </Panel>
      )}

      {mode === "done" && (
        <Panel title={result ?? "Saved"}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          <BigButton onClick={() => restart("start")} label="Do another stock job" />
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

function TopLink() {
  return (
    <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
      <ArrowLeft className="h-6 w-6" aria-hidden />
      Back
    </Link>
  );
}

function Panel({ title, helper, children }: { title: string; helper?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <Truck className="mt-1 h-8 w-8 shrink-0 text-[var(--brand)]" aria-hidden />
        <div>
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
          {helper ? <p className="mt-2 text-base leading-7 text-[var(--muted)]">{helper}</p> : null}
        </div>
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

function AmountInput({ value, onChange, unit, testId }: { value: string; onChange: (value: string) => void; unit: string; testId: string }) {
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
          data-testid={testId}
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
