"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { certifyRelease, updateReleaseVerificationItem } from "@/app/actions/releases";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ReleaseLedgerEntry } from "@/lib/server/releases";

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminReleasesClient({ releases }: { releases: ReleaseLedgerEntry[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);

  function onResult(result: Awaited<ReturnType<typeof updateReleaseVerificationItem>>) {
    setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
    if (result.ok) router.refresh();
  }

  return (
    <div>
      {feedback && (
        <p
          role="status"
          className={
            "mb-4 rounded-lg border p-3 text-sm " +
            (feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-[#e6efe9] text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff6df] text-[#5a3900]")
          }
        >
          {feedback.message}
        </p>
      )}

      <div className="grid gap-5">
        {releases.map((release) => (
          <ReleaseCard key={release.id} release={release} onResult={onResult} />
        ))}
      </div>
    </div>
  );
}

function ReleaseCard({
  release,
  onResult,
}: {
  release: ReleaseLedgerEntry;
  onResult: (result: Awaited<ReturnType<typeof updateReleaseVerificationItem>>) => void;
}) {
  const [isCertifying, startCertifying] = useTransition();
  const certificationDisabled = release.id === "fallback-v3" || release.verification?.status !== "passed" || Boolean(release.certification);

  return (
    <article className="rounded-lg border border-[#ded6ca] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">{release.version}</h2>
          <p className="mt-1 text-sm text-[#6c5e52]">
            Commit: <span className="font-mono">{release.commitSha}</span>
          </p>
          <p className="text-sm text-[#6c5e52]">Migration: {release.migrationApplied ?? "None recorded"}</p>
        </div>
        <div className="text-right text-sm text-[#6c5e52]">
          <p>Released: {new Date(release.deployedAt).toLocaleString("en-GB")}</p>
          <p>Deployer: {release.deployer ?? "Not recorded"}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(release.gateResults).map(([gate, result]) => (
          <span key={gate} className="rounded-full bg-[#f7f3ed] px-3 py-1 text-xs font-bold">
            {gate} {result}
          </span>
        ))}
      </div>

      {release.releaseNotes && <p className="mt-4 text-sm text-[#5c5148]">{release.releaseNotes}</p>}

      <section className="mt-5 border-t border-[#eee5d8] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-black">Post Release Verification</h3>
            <p className="text-sm text-[#6c5e52]">
              Status: <strong>{release.verification?.status ?? "pending"}</strong>
            </p>
          </div>
          {release.certification ? (
            <p className="rounded-full bg-[#e6efe9] px-3 py-1 text-xs font-bold text-[#0f5132]">
              Certified {release.certification.verifiedAt ? new Date(release.certification.verifiedAt).toLocaleString("en-GB") : ""}
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={certificationDisabled || isCertifying}
              onClick={() => {
                startCertifying(async () => {
                  onResult(
                    await certifyRelease({
                      releaseId: release.id,
                      hostedSmokeResult: "passed",
                      releaseReportResult: "passed",
                    }),
                  );
                });
              }}
            >
              {isCertifying ? "Certifying..." : "Certify release"}
            </Button>
          )}
        </div>

        {release.verification?.items.length ? (
          <div className="mt-4 grid gap-3">
            {release.verification.items.map((item) => (
              <VerificationItem key={item.id} item={item} onResult={onResult} />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-[#ded6ca] bg-[#fbfaf7] p-4 text-sm text-[#6c5e52]">
            Apply the V4 migration to generate the required post-release checklist.
          </p>
        )}
      </section>
    </article>
  );
}

function VerificationItem({
  item,
  onResult,
}: {
  item: NonNullable<ReleaseLedgerEntry["verification"]>["items"][number];
  onResult: (result: Awaited<ReturnType<typeof updateReleaseVerificationItem>>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(item.status);

  return (
    <form
      className="grid gap-3 rounded-lg border border-[#eee5d8] p-3 sm:grid-cols-[1fr_160px_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          onResult(await updateReleaseVerificationItem({ itemId: item.id, status }));
        });
      }}
    >
      <div>
        <p className="font-semibold">{item.label}</p>
        {item.notes && <p className="text-xs text-[#6c5e52]">{item.notes}</p>}
      </div>
      <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        <option value="pending">Pending</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
      </Select>
      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
