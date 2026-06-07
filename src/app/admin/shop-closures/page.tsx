import { AdminShopClosuresClient } from "@/components/admin-shop-closures-client";
import { PageFrame } from "@/components/site-header";
import { getShopClosures } from "@/lib/server/pickup-windows";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminShopClosuresPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const closures = await getShopClosures(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminShopClosuresClient branchId={branchId} initialClosures={closures} />
      </main>
    </PageFrame>
  );
}
