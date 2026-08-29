import { AdminComplianceClient } from "@/components/admin-compliance-client";
import { AdminEvidenceClient } from "@/components/admin-evidence-client";
import { ActionContext } from "@/components/owner-brain/action-context";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { getSuppliers } from "@/lib/server/compliance-inventory";
import { getOperatorEvidence } from "@/lib/server/operator-evidence";
import { requireStaffContext } from "@/lib/server/staff-context";
import { firstParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminCompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [suppliers, evidence, sp] = await Promise.all([
    getSuppliers(branchId),
    getOperatorEvidence(branchId),
    searchParams,
  ]);
  const evidenceToReview = evidence.filter((item) => item.status === "needs_owner_review" || item.status === "failed").length;

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Masthead
          back={<BackLink href="/admin/menu">Back to Work</BackLink>}
          eyebrow="Work"
          title="Suppliers & safety"
          subtitle="Supplier certificates, expiry checks and the files that support them."
        />
        <ActionContext from={firstParam(sp.from)} doParam={firstParam(sp.do)} focus={firstParam(sp.focus)} why={firstParam(sp.why)} />

        <AdminComplianceClient branchId={branchId} suppliers={suppliers} embedded />

        <details id="supporting-files" className="mt-6 scroll-mt-24 rounded-2xl border border-[var(--line)] bg-[var(--cream)] p-5">
          <summary className="cursor-pointer font-display text-xl font-semibold text-[var(--ink)]">
            Supporting files · {evidence.length} saved · {evidenceToReview} to review
          </summary>
          <p className="mt-2 text-sm text-[var(--muted)]">Photos and documents stay available here without becoming a separate owner destination.</p>
          <AdminEvidenceClient evidence={evidence} embedded />
        </details>
      </main>
    </PageFrame>
  );
}
