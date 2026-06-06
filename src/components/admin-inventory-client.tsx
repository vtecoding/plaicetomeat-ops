"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, ClipboardCheck } from "lucide-react";

import { adjustInventoryRemainingWithReason, createInventoryBatch, recordWaste } from "@/app/actions/compliance-inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { InventoryBatch, Supplier } from "@/lib/server/compliance-inventory";
import type { Product } from "@/lib/domain/types";
import { formatCurrency } from "@/lib/utils";

const WASTE_REASONS = ["expired", "damaged", "trim_loss", "customer_issue", "other"] as const;
const WASTE_REASON_LABEL: Record<(typeof WASTE_REASONS)[number], string> = {
  expired: "Expired",
  damaged: "Damaged stock",
  trim_loss: "Bone, fat and trimming removed",
  customer_issue: "Customer issue",
  other: "Other",
};

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminInventoryClient({
  branchId,
  products,
  suppliers,
  batches,
  canDirectAdjust,
}: {
  branchId: string;
  products: Product[];
  suppliers: Supplier[];
  batches: InventoryBatch[];
  // V11.3 — one stock-correction door. Direct adjustment here is an owner-only
  // exception; managers/staff are routed to /admin/stock-count (the authority).
  canDirectAdjust: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);

  function announce(result: Awaited<ReturnType<typeof createInventoryBatch>>) {
    setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
    if (result.ok) router.refresh();
  }

  const risk = batches.filter((batch) => batch.status === "active" && batch.daysToExpiry <= 3 && batch.remainingWeightKg > 0);
  const totalAtRisk = risk.reduce((sum, batch) => sum + batch.estimatedValueAtRisk, 0);
  const expiresToday = batches.filter((batch) => batch.status === "active" && batch.daysToExpiry === 0 && batch.remainingWeightKg > 0);
  const expiresThisWeek = batches.filter((batch) => batch.status === "active" && batch.daysToExpiry >= 0 && batch.daysToExpiry <= 7 && batch.remainingWeightKg > 0);
  const expired = batches.filter((batch) => batch.status === "active" && batch.daysToExpiry < 0 && batch.remainingWeightKg > 0);

  return (
    <div>
      <div>
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Stock</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">What arrived, what is left, and what needs using first.</p>
      </div>

      {feedback && (
        <div
          role="status"
          className={
            "mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm " +
            (feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-[#e6efe9] text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff6df] text-[#5a3900]")
          }
        >
          {feedback.tone === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-5">
        <h2 className="text-lg font-black">What expires soon?</h2>
        <p className="mt-1 text-sm font-bold text-[#231f20]">Use this stock first</p>
        <p className="mt-1 text-sm text-[#6c5e52]">
          {risk.length} stock item{risk.length === 1 ? "" : "s"} expire within 3 days. Money at risk:{" "}
          <strong>{formatCurrency(totalAtRisk)}</strong>.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Expires today</dt>
            <dd className="mt-1 text-2xl font-black">{expiresToday.length}</dd>
          </div>
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Expires this week</dt>
            <dd className="mt-1 text-2xl font-black">{expiresThisWeek.length}</dd>
          </div>
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Expired</dt>
            <dd className="mt-1 text-2xl font-black">{expired.length}</dd>
          </div>
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Money at risk</dt>
            <dd className="mt-1 text-2xl font-black">{formatCurrency(totalAtRisk)}</dd>
          </div>
        </dl>
      </section>

      <BatchForm branchId={branchId} products={products} suppliers={suppliers} onResult={announce} />

      <div className="mt-8 grid gap-4">
        {batches.length === 0 ? (
          <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">
            Add your first stock item to start expiry and waste tracking.
          </p>
        ) : (
          batches.map((batch) => (
            <BatchRow key={batch.id} batch={batch} onResult={announce} canDirectAdjust={canDirectAdjust} />
          ))
        )}
      </div>
    </div>
  );
}

function BatchForm({
  branchId,
  products,
  suppliers,
  onResult,
}: {
  branchId: string;
  products: Product[];
  suppliers: Supplier[];
  onResult: (result: Awaited<ReturnType<typeof createInventoryBatch>>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [productId, setProductId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState("");
  const [expectedWeightKg, setExpectedWeightKg] = useState("");
  const [receivedWeightKg, setReceivedWeightKg] = useState("");
  const [remainingWeightKg, setRemainingWeightKg] = useState("");
  const [invoiceCost, setInvoiceCost] = useState("");
  const [halalCertRef, setHalalCertRef] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("");
  const [storageLocation, setStorageLocation] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [actualReviewNote, setActualReviewNote] = useState("Checked during breakdown");
  const [intakeIdempotencyKey] = useState(() =>
    globalThis.crypto?.randomUUID?.() ?? `inventory-intake-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  function submit() {
    startTransition(async () => {
      onResult(
        await createInventoryBatch({
          branchId,
          productId,
          supplierId,
          receivedDate,
          expiryDate,
          expectedWeightKg: expectedWeightKg ? Number(expectedWeightKg) : Number(receivedWeightKg),
          receivedWeightKg: Number(receivedWeightKg),
          remainingWeightKg: Number(remainingWeightKg || receivedWeightKg),
          invoiceCost: Number(invoiceCost || 0),
          halalCertRef,
          countryOfOrigin,
          storageLocation,
          batchNumber,
          actualReviewNote,
          intakeIdempotencyKey,
        }),
      );
    });
  }

  return (
    <form
      className="mt-6 grid gap-4 rounded-lg border border-[#ded6ca] bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="text-lg font-black">Add stock</h2>
      <ol className="grid gap-2 rounded-md bg-[#f7f3ed] p-3 text-sm font-bold text-[#5c5148] sm:grid-cols-4">
        <li>1. What arrived?</li>
        <li>2. What did we expect?</li>
        <li>3. What did we actually get?</li>
        <li>4. Confirm stock</li>
      </ol>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">
          Product
          <Select value={productId} onChange={(event) => setProductId(event.target.value)} required>
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Supplier
          <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
            <option value="">Select supplier</option>
            {suppliers.filter((supplier) => supplier.active).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Arrived date
          <Input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Expiry date
          <Input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Estimated kg
          <Input type="number" step="0.001" min="0" value={expectedWeightKg} onChange={(event) => setExpectedWeightKg(event.target.value)} placeholder="Optional" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Actual kg
          <Input type="number" step="0.001" min="0.001" value={receivedWeightKg} onChange={(event) => setReceivedWeightKg(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Stock left kg
          <Input type="number" step="0.001" min="0" value={remainingWeightKg} onChange={(event) => setRemainingWeightKg(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Total cost
          <Input type="number" step="0.01" min="0" value={invoiceCost} onChange={(event) => setInvoiceCost(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Halal cert ref
          <Input value={halalCertRef} onChange={(event) => setHalalCertRef(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Country of origin
          <Input value={countryOfOrigin} onChange={(event) => setCountryOfOrigin(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Storage location
          <Input value={storageLocation} onChange={(event) => setStorageLocation(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Supplier batch number
          <Input value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold lg:col-span-2">
          Check note
          <Input value={actualReviewNote} onChange={(event) => setActualReviewNote(event.target.value)} maxLength={300} />
        </label>
      </div>
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-2">
          <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : "Confirm stock"}</Button>
          <p className="max-w-sm text-right text-xs leading-5 text-[#8a7d70]">
            Refreshes and double clicks reuse the same stock check, so the same arrival should not be added twice.
          </p>
        </div>
      </div>
    </form>
  );
}

function BatchRow({
  batch,
  onResult,
  canDirectAdjust,
}: {
  batch: InventoryBatch;
  onResult: (result: Awaited<ReturnType<typeof recordWaste>>) => void;
  canDirectAdjust: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [isAdjusting, startAdjustTransition] = useTransition();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<string>("expired");
  const [newRemaining, setNewRemaining] = useState(String(batch.remainingWeightKg));
  const [adjustReason, setAdjustReason] = useState("");
  const critical = batch.daysToExpiry < 0;
  const soon = batch.daysToExpiry >= 0 && batch.daysToExpiry <= 3;

  return (
    <article className={"rounded-lg border bg-white p-5 " + (critical ? "border-[#b42318]" : soon ? "border-[#d99b22]" : "border-[#ded6ca]")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">{batch.productName}</h2>
          <p className="mt-1 text-sm text-[#6c5e52]">{batch.supplierName ?? "Unknown supplier"} - {batch.storageLocation ?? "No location"}</p>
        </div>
        <span className="rounded-full bg-[#f7f3ed] px-3 py-1 text-xs font-bold">{batch.status === "active" ? "In stock" : batch.status}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-7">
        <div><dt className="font-bold">Expiry</dt><dd>{batch.expiryDate}</dd></div>
        <div><dt className="font-bold">Estimated</dt><dd>{batch.expectedWeightKg.toFixed(3)} kg</dd></div>
        <div><dt className="font-bold">Actual</dt><dd>{batch.actualWeightKg.toFixed(3)} kg</dd></div>
        <div><dt className="font-bold">Difference</dt><dd>{formatSignedKg(batch.varianceKg)}</dd></div>
        <div><dt className="font-bold">Stock left</dt><dd>{batch.remainingWeightKg.toFixed(3)} kg</dd></div>
        <div><dt className="font-bold">Cost/kg</dt><dd>{formatCurrency(batch.costPerKg)}</dd></div>
        <div><dt className="font-bold">Money at risk</dt><dd>{formatCurrency(batch.estimatedValueAtRisk)}</dd></div>
        <div><dt className="font-bold">Urgency</dt><dd>{batch.daysToExpiry < 0 ? "Expired" : batch.daysToExpiry === 0 ? "Today" : `${batch.daysToExpiry} days`}</dd></div>
      </dl>
      {Math.abs(batch.varianceKg) > 0.001 || batch.actualReviewNote ? (
        <p className="mt-3 rounded-md bg-[#f7f3ed] p-3 text-sm text-[#5c5148]">
          {Math.abs(batch.varianceKg) > 0.001 ? `Actual weight differed from estimate by ${formatSignedKg(batch.varianceKg)}. ` : ""}
          {batch.actualReviewNote ?? "Checked during breakdown."}
        </p>
      ) : null}
      <form
        className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#eee5d8] pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            onResult(await recordWaste({ batchId: batch.id, quantityKg: Number(quantity), reason }));
            setQuantity("");
          });
        }}
      >
        <label className="grid gap-1 text-sm font-semibold">
          Remove kg
          <Input type="number" step="0.001" min="0.001" max={batch.remainingWeightKg} value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Reason
          <Select value={reason} onChange={(event) => setReason(event.target.value)}>
            {WASTE_REASONS.map((item) => <option key={item} value={item}>{WASTE_REASON_LABEL[item]}</option>)}
          </Select>
        </label>
        <Button type="submit" variant="outline" disabled={isPending || batch.remainingWeightKg <= 0}>
          {isPending ? "Recording..." : "Record loss"}
        </Button>
      </form>
      {canDirectAdjust ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#eee5d8] pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            startAdjustTransition(async () => {
              onResult(
                await adjustInventoryRemainingWithReason({
                  batchId: batch.id,
                  newRemainingKg: Number(newRemaining),
                  reason: adjustReason,
                }),
              );
            });
          }}
        >
          <label className="grid gap-1 text-sm font-semibold">
            Correct stock left kg
            <Input
              type="number"
              step="0.001"
              min="0"
              max={batch.receivedWeightKg}
              value={newRemaining}
              onChange={(event) => setNewRemaining(event.target.value)}
              required
            />
          </label>
          <label className="min-w-64 flex-1 grid gap-1 text-sm font-semibold">
            Reason
            <Input
              value={adjustReason}
              onChange={(event) => setAdjustReason(event.target.value)}
              minLength={4}
              maxLength={300}
              required
            />
          </label>
          <Button type="submit" variant="outline" disabled={isAdjusting}>
            {isAdjusting ? "Correcting..." : "Correct stock (owner)"}
          </Button>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#eee5d8] pt-4">
          <p className="text-sm text-[#6c5e52]">
            Stock corrections are done in one place — the weekly Stock count.
          </p>
          <Link
            href="/admin/stock-count"
            className="inline-flex items-center gap-2 rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-4 py-2 text-sm font-bold text-[#0f5132] transition hover:bg-[#efe8dd]"
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            Correct stock in Stock count
          </Link>
        </div>
      )}
    </article>
  );
}

function formatSignedKg(value: number) {
  if (Math.abs(value) < 0.001) return "0.000 kg";
  return `${value > 0 ? "+" : ""}${value.toFixed(3)} kg`;
}
