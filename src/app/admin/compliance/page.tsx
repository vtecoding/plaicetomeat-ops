import { AdminComplianceClient } from "@/components/admin-compliance-client";
import { ActionContext } from "@/components/owner-brain/action-context";
import { PageFrame } from "@/components/site-header";
import { getSuppliers } from "@/lib/server/compliance-inventory";
import { requireStaffContext } from "@/lib/server/staff-context";
import { firstParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminCompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const suppliers = await getSuppliers(branchId);
  const sp = await searchParams;

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <ActionContext from={firstParam(sp.from)} doParam={firstParam(sp.do)} focus={firstParam(sp.focus)} why={firstParam(sp.why)} />

        <AdminComplianceClient branchId={branchId} suppliers={suppliers} />
      </main>
    </PageFrame>
  );
}
