import { AdminPickupWindowsClient } from "@/components/admin-pickup-windows-client";
import { AdminShopClosuresClient } from "@/components/admin-shop-closures-client";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { getPickupWindows, getShopClosures } from "@/lib/server/pickup-windows";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function ShopSchedulePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [windows, closures] = await Promise.all([
    getPickupWindows(branchId),
    getShopClosures(branchId),
  ]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 lg:px-8" data-testid="shop-schedule-page">
        <Masthead
          back={<BackLink href="/admin/settings">Back to Settings</BackLink>}
          eyebrow="Settings"
          title="Shop schedule"
          subtitle="Collection times and closed days live together, so customers always see one coherent schedule."
        />

        <Surface id="collection-times" className="mt-6 scroll-mt-24 p-5 sm:p-6">
          <h2 className="font-display text-2xl font-semibold text-[var(--ink)]">Collection times</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Set the windows customers can choose at checkout.</p>
          <div className="mt-4">
            <AdminPickupWindowsClient branchId={branchId} initialWindows={windows} embedded />
          </div>
        </Surface>

        <Surface id="closed-days" className="mt-6 scroll-mt-24 p-5 sm:p-6">
          <h2 className="font-display text-2xl font-semibold text-[var(--ink)]">Closed days</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Add holidays or exceptional days when the shop will not take collections.</p>
          <AdminShopClosuresClient branchId={branchId} initialClosures={closures} embedded />
        </Surface>
      </main>
    </PageFrame>
  );
}
