import { CounterDashboard } from "@/components/counter-dashboard";
import { PageFrame } from "@/components/site-header";
import { Masthead } from "@/components/ui/page";
import { getCounterOrders, getOrderNotes } from "@/lib/server/orders";
import { getPickupWindows } from "@/lib/server/pickup-windows";
import { requireStaffContext } from "@/lib/server/staff-context";
import { getRealtimeMode } from "@/lib/domain/compliance-inventory";

export default async function CounterPage() {
  const { branchId } = await requireStaffContext("staff", { branchScoped: true });

  const [orders, pickupWindows] = await Promise.all([getCounterOrders(branchId), getPickupWindows(branchId)]);
  const notesByOrderId = await getOrderNotes(orders.map((order) => order.id));

  return (
    <PageFrame>
      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Masthead eyebrow="Tablet counter view" title="Orders" />
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
