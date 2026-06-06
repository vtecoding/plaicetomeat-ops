import { redirect } from "next/navigation";

import { AdminInventoryClient } from "@/components/admin-inventory-client";
import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getAllProducts, getPublicBranch } from "@/lib/server/catalog";
import { getInventoryBatches, getSuppliers } from "@/lib/server/compliance-inventory";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage() {
  const profile = await getCurrentProfile();
  if (!profile || !MANAGER_ROLES.includes(profile.role)) redirect("/");

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const [products, suppliers, batches] = await Promise.all([
    getAllProducts(branchId),
    getSuppliers(branchId),
    getInventoryBatches(branchId),
  ]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminInventoryClient
          branchId={branchId}
          products={products}
          suppliers={suppliers}
          batches={batches}
          canDirectAdjust={profile.role === "owner"}
        />
      </main>
    </PageFrame>
  );
}
