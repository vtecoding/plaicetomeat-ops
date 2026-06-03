"use client";

import { useMemo, useState, useTransition } from "react";

import { confirmCarcassIntake } from "@/app/actions/carcass-intake";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CarcassBreakdown } from "@/lib/butchery/carcass-breakdown";
import {
  buildIntakePlan,
  buildIntakePreview,
  INTAKE_TYPES,
  INTAKE_TYPE_LABEL,
  type IntakeMapping,
} from "@/lib/domain/carcass-intake";
import { formatCurrency } from "@/lib/utils";

export type IntakeProductOption = { id: string; name: string; pricePerUnit?: number; costPerKg?: number | null };
export type IntakeSupplierOption = { id: string; name: string };

type ConfirmState =
  | { ok: true; message: string; stockCount: number; reviewCount: number; processingLossKg: number }
  | null;

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `intake-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CarcassIntakeReview({
  breakdown,
  animalId,
  daysHung,
  branchId,
  products,
  suppliers = [],
  marginOverrides,
}: {
  breakdown: CarcassBreakdown;
  animalId: string;
  daysHung: number;
  branchId: string;
  products: IntakeProductOption[];
  suppliers?: IntakeSupplierOption[];
  marginOverrides?: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [intakeType, setIntakeType] = useState(animalId === "beef" ? "side" : "whole");
  const [supplierId, setSupplierId] = useState("");
  const [receivedAt, setReceivedAt] = useState(isoToday);
  const [expiryDate, setExpiryDate] = useState(() => isoPlusDays(5));
  const [notes, setNotes] = useState("");
  const [mapping, setMapping] = useState<Record<string, IntakeMapping>>({});
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ConfirmState>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable key per unique breakdown so a reload/retry of the same intake is blocked.
  const idempotencyKey = useMemo(
    () => randomId(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animalId, breakdown.carcassWeightKg, breakdown.carcassCost, breakdown.daysHung, breakdown.blendedCostPerKgSaleable],
  );

  const productCost = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const product of products) map.set(product.id, product.costPerKg ?? null);
    return map;
  }, [products]);

  const saleableRows = breakdown.rows.filter((row) => !row.isWaste);
  const plan = useMemo(() => buildIntakePlan(breakdown, mapping), [breakdown, mapping]);
  const preview = useMemo(() => buildIntakePreview(plan), [plan]);

  function setCutMapping(cutId: string, patch: Partial<IntakeMapping>) {
    setMapping((prev) => {
      const current = prev[cutId] ?? { productId: null, updateCost: true, updatePrice: false };
      return { ...prev, [cutId]: { ...current, ...patch } };
    });
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await confirmCarcassIntake({
        branchId,
        animalId,
        intakeType,
        supplierId: supplierId || null,
        weightKg: breakdown.carcassWeightKg,
        costGbp: breakdown.carcassCost,
        daysHung,
        receivedAt,
        expiryDate,
        notes: notes.trim() || null,
        idempotencyKey,
        mapping,
        marginOverrides,
      });
      if (res.ok) {
        setResult({
          ok: true,
          message: res.message,
          stockCount: res.stockCount,
          reviewCount: res.reviewCount,
          processingLossKg: res.processingLossKg,
        });
      } else {
        setError(res.message);
      }
    });
  }

  if (result?.ok) {
    return (
      <section className="rounded-xl border border-[#b7dcc8] bg-[#e8f6ee] p-4 sm:p-5" data-testid="intake-confirmed">
        <p className="text-sm font-black uppercase tracking-[0.06em] text-[#0f5132]">Intake confirmed</p>
        <p className="mt-1 text-base font-black text-[#1f1b16]">{result.message}</p>
        <p className="mt-2 text-sm leading-6 text-[#3f6b52]">
          Stock, product cost and margin data now reflect this carcass. Bone, fat and trimming were recorded as removed
          during butchering — not counted as unsold stock thrown away.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="text-sm font-bold text-[#0f5132] underline" href="/admin/inventory">
            View inventory
          </a>
          <a className="text-sm font-bold text-[#0f5132] underline" href="/admin/products">
            View products &amp; prices
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#ded6ca] bg-[#fbfaf7] p-4 sm:p-5" data-testid="carcass-intake-panel">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5132]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="carcass-intake-toggle"
      >
        <span>
          <span className="block text-base font-black text-[#1f1b16]">Receive this carcass into stock</span>
          <span className="mt-0.5 block text-sm text-[#6c5e52]">
            Review the expected breakdown, then confirm to update stock and costs.
          </span>
        </span>
        <span className="shrink-0 text-sm font-bold text-[#0f5132]" aria-hidden>
          {open ? "Close" : "Open"}
        </span>
      </button>

      {open ? (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-[#5c5148]">How it arrived</span>
              <select
                value={intakeType}
                onChange={(e) => setIntakeType(e.target.value)}
                data-testid="intake-type"
                className="h-10 rounded-md border border-[#cfc7bb] bg-white px-2 text-sm font-bold text-[#231f20]"
              >
                {INTAKE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {INTAKE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-[#5c5148]">Supplier (optional)</span>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                data-testid="intake-supplier"
                className="h-10 rounded-md border border-[#cfc7bb] bg-white px-2 text-sm font-bold text-[#231f20]"
              >
                <option value="">Not recorded</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-[#5c5148]">Received date</span>
              <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} data-testid="intake-received-at" />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-[#5c5148]">Use-by / expiry</span>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} data-testid="intake-expiry" />
            </label>
            <label className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
              <span className="text-xs font-bold text-[#5c5148]">Notes (optional)</span>
              <Input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. batch number, condition on arrival"
                data-testid="intake-notes"
              />
            </label>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-black text-[#1f1b16]">Link cuts to products</p>
            <p className="text-xs leading-5 text-[#8a7d70]">
              Expected breakdown — actual yield varies by supplier, breed, trimming and preparation. Cuts without a
              product are recorded for review and are not stocked.
            </p>
            <div className="grid gap-2">
              {saleableRows.map((row) => {
                const cutMapping = mapping[row.id] ?? { productId: null, updateCost: true, updatePrice: false };
                const linkedCost = cutMapping.productId ? productCost.get(cutMapping.productId) ?? null : null;
                return (
                  <div
                    key={row.id}
                    className="grid gap-2 rounded-lg border border-[#e3dccf] bg-white p-3 sm:grid-cols-[1.2fr_1fr] sm:items-center"
                    data-testid={`intake-cut-${row.id}`}
                  >
                    <div>
                      <p className="text-sm font-black text-[#1f1b16]">
                        {row.name} <span className="font-bold text-[#6c5e52]">· {row.weightKg}kg</span>
                      </p>
                      <p className="text-xs text-[#6c5e52]">
                        Real cost {formatCurrency(breakdown.blendedCostPerKgSaleable)}/kg · suggested{" "}
                        {row.suggestedPricePerKg ? `${formatCurrency(row.suggestedPricePerKg)}/kg` : "—"}
                      </p>
                    </div>
                    <div className="grid gap-1.5">
                      <select
                        value={cutMapping.productId ?? ""}
                        onChange={(e) => setCutMapping(row.id, { productId: e.target.value || null })}
                        data-testid={`intake-product-${row.id}`}
                        className="h-9 rounded-md border border-[#d6cdc0] bg-white px-2 text-xs font-bold text-[#5c5148]"
                      >
                        <option value="">— not stocked —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {cutMapping.productId ? (
                        <div className="grid gap-1 text-xs text-[#6c5e52]">
                          <span>
                            Cost {linkedCost == null ? "missing" : `${formatCurrency(linkedCost)}/kg`} →{" "}
                            <strong>{formatCurrency(breakdown.blendedCostPerKgSaleable)}/kg</strong>
                          </span>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={cutMapping.updateCost ?? true}
                              onChange={(e) => setCutMapping(row.id, { updateCost: e.target.checked })}
                              data-testid={`intake-update-cost-${row.id}`}
                            />
                            Update product cost
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={cutMapping.updatePrice ?? false}
                              onChange={(e) => setCutMapping(row.id, { updatePrice: e.target.checked })}
                              data-testid={`intake-update-price-${row.id}`}
                            />
                            Update public price (
                            {row.suggestedPricePerKg ? `${formatCurrency(row.suggestedPricePerKg)}/kg` : "—"})
                          </label>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-[#ded6ca] bg-white p-3" data-testid="intake-preview">
            <p className="text-sm font-black text-[#1f1b16]">This will:</p>
            {preview.stockLines.length > 0 ? (
              <p className="mt-1 text-sm leading-6 text-[#3f6b52]">
                Create stock for{" "}
                {preview.stockLines.map((line) => `${line.cutName} +${line.weightKg}kg`).join(", ")}.
              </p>
            ) : (
              <p className="mt-1 text-sm leading-6 text-[#7a4b00]">Create no stock yet — link at least one cut to a product.</p>
            )}
            {preview.processingLossKg > 0 ? (
              <p className="mt-1 text-sm leading-6 text-[#6c5e52]">
                Record {preview.processingLossKg}kg of bone, fat and trimming removed during butchering (not unsold stock thrown away).
              </p>
            ) : null}
            {preview.reviewLines.length > 0 ? (
              <p className="mt-1 text-sm leading-6 text-[#7a4b00]" data-testid="intake-review-note">
                {preview.reviewLines.length} cut{preview.reviewLines.length === 1 ? "" : "s"} need a product —{" "}
                {preview.reviewLines.map((line) => line.cutName).join(", ")} — flagged for review, not stocked.
              </p>
            ) : null}
            {preview.costUpdates.length > 0 ? (
              <p className="mt-1 text-sm leading-6 text-[#3f6b52]">
                Update product cost for {preview.costUpdates.map((c) => c.cutName).join(", ")}.
              </p>
            ) : null}
            {preview.priceUpdates.length > 0 ? (
              <p className="mt-1 text-sm font-bold leading-6 text-[#7a4b00]">
                Update PUBLIC price for {preview.priceUpdates.map((c) => c.cutName).join(", ")}.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="lg" onClick={handleConfirm} disabled={isPending} data-testid="confirm-intake">
              {isPending ? "Confirming…" : "Confirm and update stock"}
            </Button>
            <Badge tone="amber">Review before confirming</Badge>
            {error ? (
              <p className="text-sm font-bold text-[#b42318]" data-testid="intake-error">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
