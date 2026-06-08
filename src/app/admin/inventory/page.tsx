import { AdminInventoryClient } from "@/components/admin-inventory-client";
import { PageFrame } from "@/components/site-header";
import { getAllProducts } from "@/lib/server/catalog";
import { getInventoryBatches, getSuppliers } from "@/lib/server/compliance-inventory";
import { getLastStockCountDate } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [products, suppliers, batches, lastStockCountDate] = await Promise.all([
    getAllProducts(branchId),
    getSuppliers(branchId),
    getInventoryBatches(branchId),
    getLastStockCountDate(branchId),
  ]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <AdminInventoryClient
          branchId={branchId}
          products={products}
          suppliers={suppliers}
          batches={batches}
          lastStockCountDate={lastStockCountDate}
        />
      </main>
    </PageFrame>
  );
}
