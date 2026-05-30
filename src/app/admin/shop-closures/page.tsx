import { redirect } from "next/navigation";

import { AdminShopClosuresClient } from "@/components/admin-shop-closures-client";
import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getShopClosures } from "@/lib/server/pickup-windows";

export const dynamic = "force-dynamic";

export default async function AdminShopClosuresPage() {
  const profile = await getCurrentProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const closures = await getShopClosures(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminShopClosuresClient branchId={branchId} initialClosures={closures} />
      </main>
    </PageFrame>
  );
}
