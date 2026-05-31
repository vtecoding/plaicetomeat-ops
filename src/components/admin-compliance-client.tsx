"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { saveSupplier } from "@/app/actions/compliance-inventory";
import { Button } from "@/components/ui/button";
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

  return (
    <div>
      <div>
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Supplier compliance</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">
          Track halal certificate metadata. Public trust pages only show non-sensitive certificate status.
        </p>
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

      <SupplierForm branchId={branchId} onResult={announce} />

      <div className="mt-8 grid gap-4">
        {suppliers.length === 0 ? (
          <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">
            No supplier certificate records configured yet.
          </p>
        ) : (
          suppliers.map((supplier) => (
            <article key={supplier.id} className="rounded-lg border border-[#ded6ca] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">{supplier.name}</h2>
                  <p className="mt-1 text-sm text-[#6c5e52]">
                    {supplier.certifyingBody ?? "Certifying body not set"} · ref {supplier.certNumber ?? "not set"}
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
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function SupplierForm({
  branchId,
  onResult,
}: {
  branchId: string;
  onResult: (result: Awaited<ReturnType<typeof saveSupplier>>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [certifyingBody, setCertifyingBody] = useState("");
  const [certNumber, setCertNumber] = useState("");
  const [certExpiry, setCertExpiry] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [verified, setVerified] = useState(false);
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await saveSupplier({
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
      if (result.ok) {
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
      className="mt-6 grid gap-4 rounded-lg border border-[#ded6ca] bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="text-lg font-black">Record supplier certificate</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Supplier name
          <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Certifying body
          <Input value={certifyingBody} onChange={(event) => setCertifyingBody(event.target.value)} maxLength={120} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Certificate ref
          <Input value={certNumber} onChange={(event) => setCertNumber(event.target.value)} maxLength={120} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Certificate expiry
          <Input type="date" value={certExpiry} onChange={(event) => setCertExpiry(event.target.value)} />
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
