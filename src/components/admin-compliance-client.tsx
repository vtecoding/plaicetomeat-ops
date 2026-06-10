"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { saveSupplier } from "@/app/actions/compliance-inventory";
import { Button } from "@/components/ui/button";
import { Masthead } from "@/components/ui/page";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { certificateStateLabel } from "@/lib/domain/compliance-inventory";
import type { Supplier } from "@/lib/server/compliance-inventory";

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminComplianceClient({ branchId, suppliers }: { branchId: string; suppliers: Supplier[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);

  function announce(result: Awaited<ReturnType<typeof saveSupplier>>) {
    setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
    if (result.ok) router.refresh();
  }

  const activeSuppliers = suppliers.filter((supplier) => supplier.active);
  const expired = activeSuppliers.filter((supplier) => daysToExpiry(supplier.certExpiry) !== null && daysToExpiry(supplier.certExpiry)! < 0);
  const expires7 = activeSuppliers.filter((supplier) => {
    const days = daysToExpiry(supplier.certExpiry);
    return days !== null && days >= 0 && days <= 7;
  });
  const expires30 = activeSuppliers.filter((supplier) => {
    const days = daysToExpiry(supplier.certExpiry);
    return days !== null && days > 7 && days <= 30;
  });
  const expires90 = activeSuppliers.filter((supplier) => {
    const days = daysToExpiry(supplier.certExpiry);
    return days !== null && days > 30 && days <= 90;
  });
  const missing = activeSuppliers.filter((supplier) => !supplier.certExpiry);
  const noDocument = activeSuppliers.filter((supplier) => !supplier.documentUrl);
  const notVerified = activeSuppliers.filter((supplier) => !supplier.verifiedAt);
  const health =
    expired.length + expires7.length > 0
      ? "Critical"
      : expires30.length + missing.length + noDocument.length + notVerified.length > 0
        ? "Attention Required"
        : "Healthy";

  return (
    <div>
      <Masthead
        eyebrow="Admin"
        title="Supplier compliance"
        subtitle="Track halal certificate metadata. Public trust pages only show non-sensitive certificate status."
      />

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

      <section className="mt-6 rounded-lg border border-[var(--line)] bg-white p-5">
        <h2 className="text-lg font-semibold">Compliance Dashboard</h2>
        <p className="mt-1 text-sm text-[#6c5e52]">
          Supplier status: <strong>{health}</strong>.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          <ComplianceMetric label="Expires in 90 days" value={expires90.length} />
          <ComplianceMetric label="Expires in 30 days" value={expires30.length} />
          <ComplianceMetric label="Expires in 7 days" value={expires7.length} />
          <ComplianceMetric label="Expired" value={expired.length} />
        </dl>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3" data-testid="compliance-gaps">
          <ComplianceMetric label="No expiry date" value={missing.length} />
          <ComplianceMetric label="No certificate document" value={noDocument.length} />
          <ComplianceMetric label="Not verified" value={notVerified.length} />
        </dl>
        {(missing.length > 0 || noDocument.length > 0 || notVerified.length > 0) && (
          <p className="mt-3 rounded-md border border-[#f0d8a8] bg-[#fdf6e9] px-3 py-2 text-sm font-semibold text-[#92510a]" data-testid="compliance-gap-warning">
            {[
              missing.length > 0 && `${missing.length} supplier(s) have no expiry date`,
              noDocument.length > 0 && `${noDocument.length} supplier(s) have no certificate document`,
              notVerified.length > 0 && `${notVerified.length} supplier(s) have not been verified`,
            ]
              .filter(Boolean)
              .join(" · ")}. Compliance cannot be considered healthy until all are resolved.
          </p>
        )}
      </section>

      <SupplierForm branchId={branchId} onResult={announce} />

      <div className="mt-8 grid gap-4">
        {suppliers.length === 0 ? (
          <p className="rounded-lg border border-[var(--line)] bg-white p-5 text-sm text-[#6c5e52]">
            Action required: record your first supplier certificate so public halal status is backed by internal evidence.
          </p>
        ) : (
          suppliers.map((supplier) => <SupplierCard key={supplier.id} supplier={supplier} onResult={announce} />)
        )}
      </div>
    </div>
  );
}

function ComplianceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-[#f7f3ed] p-3">
      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function daysToExpiry(date: string | null) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00.000Z`);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function SupplierCard({
  supplier,
  onResult,
}: {
  supplier: Supplier;
  onResult: (result: Awaited<ReturnType<typeof saveSupplier>>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [showEdit, setShowEdit] = useState(false);

  function verifyToday() {
    startTransition(async () => {
      onResult(
        await saveSupplier({
          supplierId: supplier.id,
          branchId: supplier.branchId ?? "",
          name: supplier.name,
          certifyingBody: supplier.certifyingBody,
          certNumber: supplier.certNumber,
          certExpiry: supplier.certExpiry,
          documentUrl: supplier.documentUrl,
          verified: true,
          active: supplier.active,
          notes: supplier.notes,
        }),
      );
    });
  }

  return (
    <article className="rounded-lg border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{supplier.name}</h2>
          <p className="mt-1 text-sm text-[#6c5e52]">
            {supplier.certifyingBody ?? "Certifying body not set"} - ref {supplier.certNumber ?? "not set"}
          </p>
        </div>
        <span className="rounded-full bg-[#f7f3ed] px-3 py-1 text-xs font-bold">
          {certificateStateLabel(supplier.status)}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="font-bold">Expiry</dt>
          <dd>{supplier.certExpiry ?? "Missing"}</dd>
        </div>
        <div>
          <dt className="font-bold">Verified</dt>
          <dd>{supplier.verifiedAt ? new Date(supplier.verifiedAt).toLocaleDateString() : "Not verified"}</dd>
        </div>
        <div>
          <dt className="font-bold">Active</dt>
          <dd>{supplier.active ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="font-bold">Document</dt>
          <dd>{supplier.documentUrl ? "Recorded" : "Metadata only"}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eee5d8] pt-4">
        <Button type="button" variant="outline" disabled={isPending || !supplier.branchId} onClick={verifyToday}>
          {isPending ? "Verifying..." : "Mark verified today"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowEdit((value) => !value)}>
          {showEdit ? "Close edit" : "Edit certificate"}
        </Button>
      </div>
      {showEdit && supplier.branchId && (
        <SupplierForm
          branchId={supplier.branchId}
          supplier={supplier}
          onResult={(result) => {
            onResult(result);
            if (result.ok) setShowEdit(false);
          }}
        />
      )}
    </article>
  );
}

function SupplierForm({
  branchId,
  supplier,
  onResult,
}: {
  branchId: string;
  supplier?: Supplier;
  onResult: (result: Awaited<ReturnType<typeof saveSupplier>>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(supplier?.name ?? "");
  const [certifyingBody, setCertifyingBody] = useState(supplier?.certifyingBody ?? "");
  const [certNumber, setCertNumber] = useState(supplier?.certNumber ?? "");
  const [certExpiry, setCertExpiry] = useState(supplier?.certExpiry ?? "");
  const [documentUrl, setDocumentUrl] = useState(supplier?.documentUrl ?? "");
  const [verified, setVerified] = useState(false);
  const [active, setActive] = useState(supplier?.active ?? true);
  const [notes, setNotes] = useState(supplier?.notes ?? "");

  function submit() {
    startTransition(async () => {
      const result = await saveSupplier({
        supplierId: supplier?.id,
        branchId,
        name,
        certifyingBody,
        certNumber,
        certExpiry,
        documentUrl,
        verified,
        active,
        notes,
      });
      onResult(result);
      if (result.ok && !supplier) {
        setName("");
        setCertifyingBody("");
        setCertNumber("");
        setCertExpiry("");
        setDocumentUrl("");
        setVerified(false);
        setNotes("");
      }
    });
  }

  return (
    <form
      className="mt-6 grid gap-4 rounded-lg border border-[var(--line)] bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="text-lg font-semibold">{supplier ? "Edit supplier certificate" : "Record supplier certificate"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Supplier name
          <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Certifying body
          <Input value={certifyingBody} onChange={(event) => setCertifyingBody(event.target.value)} required maxLength={120} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Certificate ref
          <Input value={certNumber} onChange={(event) => setCertNumber(event.target.value)} maxLength={120} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Certificate expiry
          <Input type="date" value={certExpiry} onChange={(event) => setCertExpiry(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Document URL or storage key
          <Input value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} maxLength={500} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Supplier active
          <Select value={active ? "true" : "false"} onChange={(event) => setActive(event.target.value === "true")}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
        Verified by me today
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Internal notes
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Save supplier"}
        </Button>
      </div>
    </form>
  );
}
