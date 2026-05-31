import { CounterDashboard } from "@/components/counter-dashboard";
import { PageFrame } from "@/components/site-header";
import { demoBranch } from "@/lib/data/demo";
import { getCurrentProfile } from "@/lib/server/auth";
import { getCounterOrders, getOrderNotes } from "@/lib/server/orders";
import { getPickupWindows } from "@/lib/server/pickup-windows";
import { getRealtimeMode } from "@/lib/domain/compliance-inventory";

export default async function CounterPage() {
  const profile = await getCurrentProfile();
  const branchId = profile?.branchId ?? demoBranch.id;

  const [orders, pickupWindows] = await Promise.all([getCounterOrders(branchId), getPickupWindows(branchId)]);
  const notesByOrderId = await getOrderNotes(orders.map((order) => order.id));

  return (
    <PageFrame>
      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Tablet counter view</p>
          <h1 className="mt-2 text-3xl font-black">Orders</h1>
        </div>
        <CounterDashboard
          initialOrders={orders}
          initialNotes={notesByOrderId}
          pickupWindows={pickupWindows}
          branchId={branchId}
          realtimeMode={getRealtimeMode()}
        />
      </main>
    </PageFrame>
  );
}
