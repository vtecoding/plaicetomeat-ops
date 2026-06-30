import { ReconcileClient } from "@/components/reconcile-client";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { getReconciliationItems } from "@/lib/server/reconciliation";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const tray = await getReconciliationItems(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8" data-testid="reconcile-page">
        <Masthead
          back={<BackLink href="/admin/today">Back to Today</BackLink>}
          eyebrow="Reconcile"
          title="Things to reconcile"
          subtitle="Quick bookkeeping the shop saved up for you. Clear each one — it keeps your costs and waste honest."
        />
        <ReconcileClient initialItems={tray.items} />
      </main>
    </PageFrame>
  );
}
