"use client";

import { useMemo, useRef, useState } from "react";

import { previewOrderRefund, refundOrder, saveOrderAmendment } from "@/app/actions/order-corrections";
import {
  isSubstituteSellable,
  previewOrderAmendment,
  refundDispositionLabel,
  type AmendmentKind,
  type RefundDisposition,
  type RefundPreview,
  type RefundReceipt,
} from "@/lib/domain/order-corrections";
import type { Order, Product } from "@/lib/domain/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const correctionPanel = "mt-3 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] p-4";
const bigControl = "min-h-[64px] text-base";

export function AmendOrderPanel({
  order,
  products,
  onSaved,
}: {
  order: Order;
  products: Product[];
  onSaved?: (order: Order) => void;
}) {
  const [currentOrder, setCurrentOrder] = useState(order);
  const activeLines = currentOrder.items.filter((item) => !item.isRemoved);
  const [open, setOpen] = useState(false);
  const [lineId, setLineId] = useState(activeLines[0]?.id ?? "");
  const [kind, setKind] = useState<AmendmentKind>("weight_adjust");
  const [quantity, setQuantity] = useState("");
  const [substituteId, setSubstituteId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const operationKey = useRef<string>(crypto.randomUUID());

  const line = activeLines.find((item) => item.id === lineId) ?? activeLines[0];
  const substitutes = line
    ? products.filter(
        (product) => isSubstituteSellable(product) && product.unitType === line.unitType && product.id !== line.productId,
      )
    : [];
  const substitute = substitutes.find((product) => product.id === substituteId);
  const parsedQuantity = quantity.trim() === "" ? null : Number(quantity);
  const preview = line
    ? previewOrderAmendment(
        line,
        { kind, newQuantity: kind === "remove" ? 0 : parsedQuantity, substituteProductId: substituteId || null },
        substitute,
      )
    : null;

  async function save() {
    if (!line || !preview) return;
    setError(null);
    setSaved(null);
    if (kind === "weight_adjust" && (!parsedQuantity || parsedQuantity <= 0)) {
      setError("Enter the actual weight.");
      return;
    }
    if (kind === "substitute" && !substitute) {
      setError("Choose the substitute product.");
      return;
    }
    if (preview.priceIncrease && !confirmed) {
      setError("Confirm the customer agrees to the higher final price.");
      return;
    }

    setSaving(true);
    const result = await saveOrderAmendment({
      orderId: currentOrder.id,
      orderItemId: line.id,
      kind,
      newQuantity: kind === "remove" ? 0 : parsedQuantity,
      substituteProductId: kind === "substitute" ? substituteId : null,
      reason,
      idempotencyKey: operationKey.current,
      expectedSequence: currentOrder.amendmentSequence ?? 0,
      confirmPriceIncrease: confirmed,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setCurrentOrder(result.order);
    onSaved?.(result.order);
    operationKey.current = crypto.randomUUID();
    setLineId(result.order.items.find((item) => !item.isRemoved)?.id ?? "");
    setQuantity("");
    setSubstituteId("");
    setReason("");
    setConfirmed(false);
    setSaved("Saved. Final price and stock now use this adjustment.");
    setOpen(false);
  }

  if (!activeLines.length) return null;

  return (
    <div className={correctionPanel} data-testid="order-amendment-panel">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
          setSaved(null);
        }}
        data-testid="order-adjust-start"
      >
        Adjust at handover
      </Button>

      {saved ? <p className="mt-3 text-sm font-bold text-[var(--brand)]" role="status">{saved}</p> : null}
      {open ? (
        <div className="mt-4 grid gap-4">
          <div>
            <label className="text-sm font-bold" htmlFor={`amend-line-${currentOrder.id}`}>Which item?</label>
            <Select
              id={`amend-line-${currentOrder.id}`}
              className={bigControl}
              value={line?.id ?? ""}
              onChange={(event) => {
                setLineId(event.target.value);
                setSubstituteId("");
                setQuantity("");
                setConfirmed(false);
              }}
            >
              {activeLines.map((item) => <option key={item.id} value={item.id}>{item.productNameSnapshot}</option>)}
            </Select>
          </div>

          <fieldset>
            <legend className="text-sm font-bold">What changed?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(["weight_adjust", "substitute", "remove"] as AmendmentKind[]).map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  variant={kind === choice ? "default" : "outline"}
                  size="lg"
                  className="min-h-[64px]"
                  disabled={choice === "weight_adjust" && line?.unitType !== "kg"}
                  onClick={() => {
                    setKind(choice);
                    setConfirmed(false);
                  }}
                >
                  {choice === "weight_adjust" ? "Actual weight" : choice === "substitute" ? "Substitute" : "Remove line"}
                </Button>
              ))}
            </div>
          </fieldset>

          {kind === "weight_adjust" ? (
            <label className="text-sm font-bold">
              Actual weight (kg)
              <Input
                className={bigControl}
                type="number"
                min="0.001"
                step="0.001"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                data-testid="amend-actual-weight"
              />
            </label>
          ) : null}

          {kind === "substitute" ? (
            <label className="text-sm font-bold">
              Substitute product
              <Select className={bigControl} value={substituteId} onChange={(event) => setSubstituteId(event.target.value)}>
                <option value="">Choose one</option>
                {substitutes.map((product) => (
                  <option key={product.id} value={product.id}>{product.name} — {formatCurrency(product.pricePerUnit)}/{product.unitType}</option>
                ))}
              </Select>
            </label>
          ) : null}

          <label className="text-sm font-bold">
            Reason (optional)
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} />
          </label>

          {line && preview ? (
            <div className="rounded-lg bg-[var(--cream)] p-4 text-sm" data-testid="amendment-preview">
              <p><strong>Ordered:</strong> {line.originalQuantity ?? line.quantity} {line.originalUnitType ?? line.unitType} {line.originalProductName ?? line.productNameSnapshot} — {formatCurrency(line.originalLineTotal ?? line.lineTotal)}</p>
              <p className="mt-2"><strong>Final:</strong> {preview.removed ? "Removed" : `${preview.quantity} ${preview.unitType} ${preview.productName} — ${formatCurrency(preview.lineTotal)}`}</p>
              {preview.priceIncrease ? (
                <label className="mt-3 flex min-h-[64px] items-center gap-3 rounded-lg border border-[var(--clay)] bg-white p-3 font-bold">
                  <input type="checkbox" className="h-6 w-6" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                  Customer is here and agrees to the new final price
                </label>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="rounded-lg bg-[#fdeaea] p-3 text-sm font-bold text-[#7a1b1b]" role="alert">{error}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" size="lg" className="min-h-[64px]" disabled={saving} onClick={() => void save()} data-testid="amend-save">
              {saving ? "Saving…" : "Save final item"}
            </Button>
            <Button type="button" variant="outline" size="lg" className="min-h-[64px]" disabled={saving} onClick={() => setOpen(false)}>Back</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type RefundStage = "closed" | "lines" | "reason" | "summary" | "done";

export function RefundOrderPanel({ order }: { order: Order }) {
  const activeLines = order.items.filter((item) => !item.isRemoved && item.quantity > 0);
  const [stage, setStage] = useState<RefundStage>("closed");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, RefundDisposition>>({});
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [receipt, setReceipt] = useState<RefundReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string>(crypto.randomUUID());

  const chosenLines = useMemo(
    () => activeLines.flatMap((line) => selected[line.id]
      ? [{
          orderItemId: line.id,
          quantity: Number(quantities[line.id] || line.quantity),
          disposition: dispositions[line.id] ?? "customer_kept" as RefundDisposition,
        }]
      : []),
    [activeLines, dispositions, quantities, selected],
  );

  function restart() {
    operationId.current = crypto.randomUUID();
    setStage("lines");
    setSelected({});
    setQuantities({});
    setDispositions({});
    setReason("");
    setPreview(null);
    setReceipt(null);
    setError(null);
  }

  async function buildSummary() {
    if (reason.trim().length === 0) {
      setError("Say why the refund is needed.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await previewOrderRefund({ orderId: order.id, lines: chosenLines });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPreview(result.preview);
    setStage("summary");
  }

  async function confirmRefund() {
    setBusy(true);
    setError(null);
    const result = await refundOrder({
      refundOperationId: operationId.current,
      orderId: order.id,
      lines: chosenLines,
      reason,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReceipt(result.receipt);
    setStage("done");
  }

  if (!activeLines.length) return null;

  return (
    <div className={correctionPanel} data-testid="order-refund-panel">
      {stage === "closed" ? (
        <Button type="button" variant="destructive" size="lg" className="w-full" onClick={restart} data-testid="refund-start">
          Refund / fix
        </Button>
      ) : null}

      {stage === "lines" ? (
        <div className="grid gap-4">
          <div>
            <p className="text-lg font-black">1. Which items, and what happened to them?</p>
            <p className="text-sm text-[var(--muted)]">The original sale decides whether money goes back as cash or card.</p>
          </div>
          {activeLines.map((line) => (
            <div key={line.id} className="rounded-lg border border-[var(--line)] bg-white p-3">
              <label className="flex min-h-[56px] items-center gap-3 font-bold">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={selected[line.id] ?? false}
                  onChange={(event) => setSelected((current) => ({ ...current, [line.id]: event.target.checked }))}
                />
                {line.productNameSnapshot} — {line.quantity} {line.unitType}
              </label>
              {selected[line.id] ? (
                <div className="mt-3 grid gap-3">
                  <label className="text-sm font-bold">Quantity
                    <Input
                      className={bigControl}
                      type="number"
                      min={line.unitType === "kg" ? "0.001" : "1"}
                      max={line.quantity}
                      step={line.unitType === "kg" ? "0.001" : "1"}
                      inputMode={line.unitType === "kg" ? "decimal" : "numeric"}
                      value={quantities[line.id] ?? String(line.quantity)}
                      onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                    />
                  </label>
                  <label className="text-sm font-bold">What happened to the product?
                    <Select
                      className={bigControl}
                      value={dispositions[line.id] ?? "customer_kept"}
                      onChange={(event) => setDispositions((current) => ({
                        ...current,
                        [line.id]: event.target.value as RefundDisposition,
                      }))}
                    >
                      <option value="customer_kept">Customer kept it</option>
                      <option value="returned_restockable">Returned — sellable</option>
                      <option value="returned_discarded">Returned — discard it</option>
                    </Select>
                  </label>
                </div>
              ) : null}
            </div>
          ))}
          {error ? <p className="rounded-lg bg-[#fdeaea] p-3 text-sm font-bold text-[#7a1b1b]" role="alert">{error}</p> : null}
          <Button
            type="button"
            size="lg"
            className="min-h-[64px]"
            disabled={chosenLines.length === 0}
            onClick={() => {
              setError(null);
              if (chosenLines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
                setError("Enter a positive quantity for every selected item.");
                return;
              }
              if (chosenLines.some((chosen) => {
                const line = activeLines.find((candidate) => candidate.id === chosen.orderItemId);
                return line?.unitType !== "kg" && !Number.isInteger(chosen.quantity);
              })) {
                setError("Each and box quantities must be whole counts.");
                return;
              }
              setStage("reason");
            }}
          >
            Next
          </Button>
          <Button type="button" variant="outline" size="lg" className="min-h-[64px]" onClick={() => setStage("closed")}>Back</Button>
        </div>
      ) : null}

      {stage === "reason" ? (
        <div className="grid gap-4">
          <p className="text-lg font-black">2. Why is the refund needed?</p>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={500} placeholder="Customer return, quality issue, wrong item…" />
          {error ? <p className="rounded-lg bg-[#fdeaea] p-3 text-sm font-bold text-[#7a1b1b]" role="alert">{error}</p> : null}
          <Button type="button" size="lg" className="min-h-[64px]" disabled={busy} onClick={() => void buildSummary()}>
            {busy ? "Checking…" : "Review refund"}
          </Button>
          <Button type="button" variant="outline" size="lg" className="min-h-[64px]" disabled={busy} onClick={() => setStage("lines")}>Back</Button>
        </div>
      ) : null}

      {stage === "summary" && preview ? (
        <div className="grid gap-4" data-testid="refund-summary">
          <p className="text-lg font-black">3. Check money and stock</p>
          <div className="rounded-lg bg-[var(--cream)] p-4">
            <p className="text-xl font-black">Refund {formatCurrency(preview.totalAmountPence / 100)}</p>
            {preview.money.map((money) => (
              <p key={money.method} className="mt-1 font-bold">
                {formatCurrency(money.amountPence / 100)} to {money.method} — the way they paid
              </p>
            ))}
          </div>
          <ul className="grid gap-2 text-sm">
            {chosenLines.map((line) => {
              const name = activeLines.find((item) => item.id === line.orderItemId)?.productNameSnapshot ?? "Item";
              return <li key={line.orderItemId} className="rounded-lg border border-[var(--line)] p-3"><strong>{name}:</strong> {refundDispositionLabel(line.disposition)}</li>;
            })}
          </ul>
          {error ? <p className="rounded-lg bg-[#fdeaea] p-3 text-sm font-bold text-[#7a1b1b]" role="alert">{error}</p> : null}
          <Button type="button" variant="destructive" size="lg" className="min-h-[64px]" disabled={busy} onClick={() => void confirmRefund()} data-testid="refund-confirm">
            {busy ? "Recording…" : `Confirm ${formatCurrency(preview.totalAmountPence / 100)} refund`}
          </Button>
          <Button type="button" variant="outline" size="lg" className="min-h-[64px]" disabled={busy} onClick={() => setStage("reason")}>Back</Button>
        </div>
      ) : null}

      {stage === "done" && receipt ? (
        <div className="grid gap-3" data-testid="refund-receipt">
          <p className="text-xl font-black">Refund recorded</p>
          <p>{formatCurrency(receipt.totalAmountPence / 100)} returned by {receipt.money.map((line) => line.method).join(" and ")}.</p>
          <p className="text-sm text-[var(--muted)]">Money, stock outcome and reason were saved together.</p>
          <Button type="button" variant="outline" size="lg" className="min-h-[64px]" onClick={() => setStage("closed")}>Done</Button>
          <Button type="button" variant="outline" size="lg" className="min-h-[64px]" onClick={restart}>Record another refund</Button>
        </div>
      ) : null}
    </div>
  );
}
