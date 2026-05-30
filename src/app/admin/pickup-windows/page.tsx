import { redirect } from "next/navigation";

import { AdminPickupWindowsClient } from "@/components/admin-pickup-windows-client";
import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getPickupWindows } from "@/lib/server/pickup-windows";

export const dynamic = "force-dynamic";

export default async function AdminPickupWindowsPage() {
  const profile = await getCurrentProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const windows = await getPickupWindows(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminPickupWindowsClient branchId={branchId} initialWindows={windows} />
      </main>
    </PageFrame>
  );
}
