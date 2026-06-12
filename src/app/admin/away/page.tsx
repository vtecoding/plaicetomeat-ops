import { AdminOwnerAwayClient } from "@/components/admin-owner-away-client";
import { PageFrame } from "@/components/site-header";
import { getOwnerAwaySummary } from "@/lib/server/owner-away";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminOwnerAwayPage() {
  const { branchId } = await requireStaffContext("owner", { branchScoped: true });
  const summary = await getOwnerAwaySummary(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <AdminOwnerAwayClient summary={summary} />
      </main>
    </PageFrame>
  );
}
