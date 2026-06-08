import { AdminPickupWindowsClient } from "@/components/admin-pickup-windows-client";
import { PageFrame } from "@/components/site-header";
import { getPickupWindows } from "@/lib/server/pickup-windows";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminPickupWindowsPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const windows = await getPickupWindows(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminPickupWindowsClient branchId={branchId} initialWindows={windows} />
      </main>
    </PageFrame>
  );
}
