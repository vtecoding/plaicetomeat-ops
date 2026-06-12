import { AdminEvidenceClient } from "@/components/admin-evidence-client";
import { PageFrame } from "@/components/site-header";
import { requireStaffContext } from "@/lib/server/staff-context";
import { getOperatorEvidence } from "@/lib/server/operator-evidence";

export const dynamic = "force-dynamic";

export default async function AdminEvidencePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const evidence = await getOperatorEvidence(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">
        <AdminEvidenceClient evidence={evidence} />
      </main>
    </PageFrame>
  );
}
