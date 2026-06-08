import { AdminComplianceClient } from "@/components/admin-compliance-client";
import { PageFrame } from "@/components/site-header";
import { getSuppliers } from "@/lib/server/compliance-inventory";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminCompliancePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const suppliers = await getSuppliers(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminComplianceClient branchId={branchId} suppliers={suppliers} />
      </main>
    </PageFrame>
  );
}
