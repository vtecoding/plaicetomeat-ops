import { CounterDashboard } from "@/components/counter-dashboard";
import { PageFrame } from "@/components/site-header";
import { getDemoOrders } from "@/lib/data/demo";

export default function CounterPage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Tablet counter view</p>
          <h1 className="mt-2 text-3xl font-black">Orders</h1>
        </div>
        <CounterDashboard initialOrders={getDemoOrders()} />
      </main>
    </PageFrame>
  );
}
