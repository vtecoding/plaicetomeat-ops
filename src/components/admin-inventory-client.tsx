"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { adjustInventoryRemainingWithReason, createInventoryBatch, recordWaste } from "@/app/actions/compliance-inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { InventoryBatch, Supplier } from "@/lib/server/compliance-inventory";
import type { Product } from "@/lib/domain/types";
import { formatCurrency } from "@/lib/utils";

const WASTE_REASONS = ["expired", "damaged", "trim_loss", "customer_issue", "other"] as const;

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminInventoryClient({
  branchId,
  products,
  suppliers,
  batches,
}: {
  branchId: string;
  products: Product[];
  suppliers: Supplier[];
  batches: InventoryBatch[];
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
        <h1 className="mt-2 text-3xl font-black">Inventory batches</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">Batch visibility for expiry and waste prevention.</p>
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
        <h2 className="text-lg font-black">Expiry Command Centre</h2>
        <p className="mt-1 text-sm font-bold text-[#231f20]">Expiry and waste risk</p>
        <p className="mt-1 text-sm text-[#6c5e52]">
          {risk.length} active batch{risk.length === 1 ? "" : "es"} expiring within 3 days. Estimated value at risk:{" "}
          <strong>{formatCurrency(totalAtRisk)}</strong>.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Expires Today</dt>
            <dd className="mt-1 text-2xl font-black">{expiresToday.length}</dd>
          </div>
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Expires This Week</dt>
            <dd className="mt-1 text-2xl font-black">{expiresThisWeek.length}</dd>
          </div>
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Expired</dt>
            <dd className="mt-1 text-2xl font-black">{expired.length}</dd>
          </div>
          <div className="rounded-md bg-[#f7f3ed] p-3">
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Value At Risk</dt>
            <dd className="mt-1 text-2xl font-black">{formatCurrency(totalAtRisk)}</dd>
          </div>
        </dl>
      </section>

      <BatchForm branchId={branchId} products={products} suppliers={suppliers} onResult={announce} />

      <div className="mt-8 grid gap-4">
        {batches.length === 0 ? (
          <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">
            Action required: receive your first inventory batch to enable expiry and waste tracking.
          </p>
        ) : (
          batches.map((batch) => <BatchRow key={batch.id} batch={batch} onResult={announce} />)
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
  const [receivedWeightKg, setReceivedWeightKg] = useState("");
  const [remainingWeightKg, setRemainingWeightKg] = useState("");
  const [invoiceCost, setInvoiceCost] = useState("");
  const [halalCertRef, setHalalCertRef] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("");
  const [storageLocation, setStorageLocation] = useState("");
  const [batchNumber, setBatchNumber] = useState("");

  function submit() {
    startTransition(async () => {
      onResult(
        await createInventoryBatch({
          branchId,
          productId,
          supplierId,
          receivedDate,
          expiryDate,
          receivedWeightKg: Number(receivedWeightKg),
          remainingWeightKg: Number(remainingWeightKg || receivedWeightKg),
          invoiceCost: Number(invoiceCost || 0),
          halalCertRef,
          countryOfOrigin,
          storageLocation,
          batchNumber,
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
      <h2 className="text-lg font-black">Receive batch</h2>
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
          Received date
          <Input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Expiry date
          <Input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Received kg
          <Input type="number" step="0.001" min="0.001" value={receivedWeightKg} onChange={(event) => setReceivedWeightKg(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Remaining kg
          <Input type="number" step="0.001" min="0" value={remainingWeightKg} onChange={(event) => setRemainingWeightKg(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Invoice cost
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
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : "Receive batch"}</Button>
      </div>
    </form>
  );
}

function BatchRow({
  batch,
  onResult,
}: {
  batch: InventoryBatch;
  onResult: (result: Awaited<ReturnType<typeof recordWaste>>) => void;
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
          <p className="mt-1 text-sm text-[#6c5e52]">{batch.supplierName ?? "Unknown supplier"} · {batch.storageLocation ?? "No location"}</p>
        </div>
        <span className="rounded-full bg-[#f7f3ed] px-3 py-1 text-xs font-bold">{batch.status}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-5">
        <div><dt className="font-bold">Expiry</dt><dd>{batch.expiryDate}</dd></div>
        <div><dt className="font-bold">Tracked remaining kg</dt><dd>{batch.remainingWeightKg.toFixed(3)} kg</dd></div>
        <div><dt className="font-bold">Cost/kg</dt><dd>{formatCurrency(batch.costPerKg)}</dd></div>
        <div><dt className="font-bold">At risk</dt><dd>{formatCurrency(batch.estimatedValueAtRisk)}</dd></div>
        <div><dt className="font-bold">Urgency</dt><dd>{batch.daysToExpiry < 0 ? "Expired" : batch.daysToExpiry === 0 ? "Today" : `${batch.daysToExpiry} days`}</dd></div>
      </dl>
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
          Waste kg
          <Input type="number" step="0.001" min="0.001" max={batch.remainingWeightKg} value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Reason
          <Select value={reason} onChange={(event) => setReason(event.target.value)}>
            {WASTE_REASONS.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
          </Select>
        </label>
        <Button type="submit" variant="outline" disabled={isPending || batch.remainingWeightKg <= 0}>
          {isPending ? "Recording..." : "Record waste"}
        </Button>
      </form>
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
          Adjust tracked remaining kg
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
          Adjustment reason
          <Input
            value={adjustReason}
            onChange={(event) => setAdjustReason(event.target.value)}
            minLength={4}
            maxLength={300}
            required
          />
        </label>
        <Button type="submit" variant="outline" disabled={isAdjusting}>
          {isAdjusting ? "Adjusting..." : "Adjust stock"}
        </Button>
      </form>
    </article>
  );
}
