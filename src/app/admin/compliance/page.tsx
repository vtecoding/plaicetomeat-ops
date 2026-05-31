import { redirect } from "next/navigation";

import { AdminComplianceClient } from "@/components/admin-compliance-client";
import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getSuppliers } from "@/lib/server/compliance-inventory";

export const dynamic = "force-dynamic";

export default async function AdminCompliancePage() {
  const profile = await getCurrentProfile();
  if (!profile || !MANAGER_ROLES.includes(profile.role)) redirect("/");

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const suppliers = await getSuppliers(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminComplianceClient branchId={branchId} suppliers={suppliers} />
      </main>
    </PageFrame>
  );
}
