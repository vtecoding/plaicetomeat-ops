import { CheckoutClient } from "@/components/checkout-client";
import { PageFrame } from "@/components/site-header";
import { getBranchSettingsResult, getPublicBranchResult } from "@/lib/server/catalog";
import { getPickupWindowsResult } from "@/lib/server/pickup-windows";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const branchResult = await getPublicBranchResult();
  if (!branchResult.data) return <CheckoutUnavailable message={branchResult.message} />;
  const branch = branchResult.data;
  const [pickupWindowsResult, settingsResult] = await Promise.all([
    getPickupWindowsResult(branch.id),
    getBranchSettingsResult(branch.id),
  ]);
  if (!settingsResult.data) return <CheckoutUnavailable message={settingsResult.message} />;
  const pickupWindows = (pickupWindowsResult.data ?? []).filter((window) => window.isActive);
  const settings = settingsResult.data;

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

function CheckoutUnavailable({ message }: { message: string }) {
  return (
    <PageFrame>
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-[#f0c66e] bg-[#fff8e6] p-6 text-[#5a3900]" data-testid="public-truth-state">
          <h1 className="text-2xl font-black">Checkout is not ready</h1>
          <p className="mt-3 text-sm font-semibold">{message}</p>
        </section>
      </main>
    </PageFrame>
  );
}
