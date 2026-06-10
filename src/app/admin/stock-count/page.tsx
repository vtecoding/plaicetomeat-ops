import { ActionContext } from "@/components/owner-brain/action-context";
import { StockCount } from "@/components/ops-capture/stock-count";
import { PageFrame } from "@/components/site-header";
import { Masthead } from "@/components/ui/page";
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

        <Masthead
          eyebrow="Stock count"
          title="Count what's really there"
          subtitle={'Keep the system honest, so "running low" can be trusted.'}
        />

        <div className="mt-6">
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
