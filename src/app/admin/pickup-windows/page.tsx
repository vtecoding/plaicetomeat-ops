import { PageFrame } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoPickupWindows } from "@/lib/data/demo";
import { formatTimeRange } from "@/lib/utils";

export default function AdminPickupWindowsPage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
            <h1 className="mt-2 text-3xl font-black">Pickup windows</h1>
          </div>
          <Button type="button">Add window</Button>
        </div>
        <div className="mt-8 grid gap-4">
          {demoPickupWindows.map((window) => (
            <article key={window.id} className="rounded-lg border border-[#ded6ca] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-black">{window.label}</p>
                  <p className="text-sm text-[#6c5e52]">{formatTimeRange(window.startTime, window.endTime)}</p>
                </div>
                <Badge tone={window.windowType === "commuter" ? "green" : "neutral"}>{window.windowType}</Badge>
              </div>
              <p className="mt-3 text-sm text-[#6c5e52]">
                Days: {window.daysOfWeek.join(", ")}. Cutoff: {window.cutoffTime ?? "None"}. Max orders: {window.maxOrders ?? "Unlimited"}.
              </p>
            </article>
          ))}
        </div>
      </main>
    </PageFrame>
  );
}
