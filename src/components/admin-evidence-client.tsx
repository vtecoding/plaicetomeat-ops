"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Trash2 } from "lucide-react";

import { deleteOperatorEvidence } from "@/app/actions/operator/evidence";
import { Button } from "@/components/ui/button";
import { Masthead } from "@/components/ui/page";
import type { OperatorEvidence } from "@/lib/server/operator-evidence";

type Feedback = { tone: "ok" | "error"; message: string } | null;

const evidenceLabels: Record<string, string> = {
  delivery_note: "Delivery note",
  supplier_document: "Supplier document",
  certificate: "Certificate",
  fridge_check: "Fridge check",
  waste_photo: "Waste photo",
  other: "Other evidence",
};

const statusLabels: Record<string, string> = {
  uploaded: "Uploaded",
  linked: "Linked",
  needs_owner_review: "Needs review",
  deleted: "Deleted",
  failed: "Failed",
};

export function AdminEvidenceClient({ evidence }: { evidence: OperatorEvidence[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);

  function announce(result: Awaited<ReturnType<typeof deleteOperatorEvidence>>) {
    setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
    if (result.ok) router.refresh();
  }

  const reviewCount = evidence.filter((item) => item.status === "needs_owner_review" || item.status === "failed").length;

  return (
    <div>
      <Masthead
        eyebrow="Admin"
        title="Evidence"
        subtitle="Operator photos and documents that back deliveries, waste, certificates and compliance checks."
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
        <h2 className="text-lg font-semibold">Latest evidence</h2>
        <p className="mt-1 text-sm text-[#6c5e52]">
          {evidence.length} item{evidence.length === 1 ? "" : "s"} saved. {reviewCount} need review.
        </p>
      </section>

      <div className="mt-6 grid gap-4">
        {evidence.length === 0 ? (
          <p className="rounded-lg border border-[var(--line)] bg-white p-5 text-sm text-[#6c5e52]">
            No evidence has been uploaded yet.
          </p>
        ) : (
          evidence.map((item) => <EvidenceCard key={item.id} item={item} onResult={announce} />)
        )}
      </div>
    </div>
  );
}

function EvidenceCard({
  item,
  onResult,
}: {
  item: OperatorEvidence;
  onResult: (result: Awaited<ReturnType<typeof deleteOperatorEvidence>>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const canDelete = item.status !== "deleted";

  function deleteItem() {
    startTransition(async () => {
      onResult(await deleteOperatorEvidence({ evidenceId: item.id }));
    });
  }

  return (
    <article className="rounded-lg border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{evidenceLabels[item.evidenceType] ?? item.evidenceType}</h2>
          <p className="mt-1 text-sm text-[#6c5e52]">{item.fileName ?? "No filename recorded"}</p>
        </div>
        <span className="rounded-full bg-[#f7f3ed] px-3 py-1 text-xs font-bold">{statusLabels[item.status] ?? item.status}</span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
        <EvidenceFact label="Uploaded" value={new Date(item.createdAt).toLocaleString("en-GB")} />
        <EvidenceFact label="By" value={item.uploadedByName ?? "Staff"} />
        <EvidenceFact label="Source" value={sourceLabel(item)} />
        <EvidenceFact label="Size" value={formatBytes(item.sizeBytes)} />
      </dl>

      {item.failureReason ? (
        <p className="mt-4 rounded-md border border-[#f0d8a8] bg-[#fdf6e9] px-3 py-2 text-sm font-semibold text-[#92510a]">
          Upload failed: {item.failureReason}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eee5d8] pt-4">
        {item.signedUrl ? (
          <Button asChild variant="outline">
            <a href={item.signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden />
              Open evidence
            </a>
          </Button>
        ) : null}
        <Button type="button" variant="destructive" disabled={isPending || !canDelete} onClick={deleteItem}>
          <Trash2 className="h-4 w-4" aria-hidden />
          {isPending ? "Deleting..." : "Delete"}
        </Button>
      </div>
    </article>
  );
}

function EvidenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function sourceLabel(item: OperatorEvidence) {
  const base = item.sourceType.replace(/_/g, " ");
  return item.sourceRef ? `${base}: ${item.sourceRef}` : base;
}

function formatBytes(value: number | null) {
  if (value === null) return "Unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
