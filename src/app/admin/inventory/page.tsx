import { AdminInventoryClient } from "@/components/admin-inventory-client";
import { ActionContext } from "@/components/owner-brain/action-context";
import { PageFrame } from "@/components/site-header";
import { getAllProducts } from "@/lib/server/catalog";
import { getInventoryBatches, getSuppliers } from "@/lib/server/compliance-inventory";
import { getLastStockCountDate } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";
import { firstParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [products, suppliers, batches, lastStockCountDate] = await Promise.all([
    getAllProducts(branchId),
    getSuppliers(branchId),
    getInventoryBatches(branchId),
    getLastStockCountDate(branchId),
  ]);
  const sp = await searchParams;
  const focus = firstParam(sp.focus);

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <ActionContext from={firstParam(sp.from)} doParam={firstParam(sp.do)} focus={focus} why={firstParam(sp.why)} />

        <AdminInventoryClient
          branchId={branchId}
          products={products}
          suppliers={suppliers}
          batches={batches}
          lastStockCountDate={lastStockCountDate}
          focusSlug={focus ?? null}
        />
      </main>
    </PageFrame>
  );
}
