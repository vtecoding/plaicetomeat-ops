import { CheckoutClient } from "@/components/checkout-client";
import { PageFrame } from "@/components/site-header";
import { getBranchSettings, getPublicBranch } from "@/lib/server/catalog";
import { getActivePickupWindows } from "@/lib/server/pickup-windows";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const branch = await getPublicBranch();
  const [pickupWindows, settings] = await Promise.all([
    getActivePickupWindows(branch.id),
    getBranchSettings(branch.id),
  ]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <CheckoutClient
          branchId={branch.id}
          pickupWindows={pickupWindows}
          minOrderValue={settings.minOrderValue}
          sameDayCutoffTime={settings.sameDayCutoffTime}
          testModeEnabled={process.env.NEXT_PUBLIC_CHECKOUT_TEST_MODE === "true"}
        />
      </main>
    </PageFrame>
  );
}
