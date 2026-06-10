import { ActionContext } from "@/components/owner-brain/action-context";
import { StockCount } from "@/components/ops-capture/stock-count";
import { PageFrame } from "@/components/site-header";
import { getStockCountState } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";
import { firstParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StockCountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const state = await getStockCountState(branchId);
  const sp = await searchParams;
  const focus = firstParam(sp.focus);

  return (
    <PageFrame>
      <main className="mx-auto max-w-2xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="stock-count-page">
        <ActionContext from={firstParam(sp.from)} doParam={firstParam(sp.do)} focus={focus} why={firstParam(sp.why)} />

        <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Stock count</p>
          <h1 className="mt-2 text-3xl font-black">Count what&apos;s really there</h1>
          <p className="mt-2 text-sm font-semibold text-[#6c5e52]">Keep the system honest, so &quot;running low&quot; can be trusted.</p>
        </header>

        <div className="mt-4">
          <StockCount
            branchId={branchId}
            initialSessionId={state.sessionId}
            batches={state.batches}
            initialLines={state.lines}
            focusSlug={focus ?? null}
          />
        </div>
      </main>
    </PageFrame>
  );
}
