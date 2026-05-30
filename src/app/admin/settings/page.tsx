import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { demoBranch, demoBranchSettings } from "@/lib/data/demo";

export default function AdminSettingsPage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Branch settings</h1>
        <section className="mt-8 rounded-lg border border-[#ded6ca] bg-white p-6">
          <form className="grid gap-5">
            <div className="grid gap-2">
              <label className="text-sm font-semibold" htmlFor="address">
                Address
              </label>
              <Input id="address" defaultValue={demoBranch.address} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-semibold" htmlFor="template">
                Ready SMS template
              </label>
              <Textarea id="template" defaultValue={demoBranchSettings.smsReadyTemplate} />
              <p className="text-xs text-[#6c5e52]">Supported placeholders: {"{order_ref}"} and {"{address}"}.</p>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-semibold" htmlFor="window">
                Customer cancellation window minutes
              </label>
              <Input id="window" type="number" defaultValue={demoBranchSettings.cancellationWindowMinutes} />
            </div>
            <Button type="button">Save settings</Button>
          </form>
        </section>
      </main>
    </PageFrame>
  );
}
