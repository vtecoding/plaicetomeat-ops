import { ReconcileClient } from "@/components/reconcile-client";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { getReconciliationItems } from "@/lib/server/reconciliation";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const { branchId } = await requireStaffContext("owner", { branchScoped: true });
  const tray = await getReconciliationItems(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8" data-testid="reconcile-page">
        <Masthead
          back={<BackLink href="/admin/today">Back to Today</BackLink>}
          eyebrow="Owner jobs"
          title="Jobs waiting for you"
          subtitle="Every open shop alert is here. Open the right work, then leave a short note when it is sorted."
        />
        <ReconcileClient initialItems={tray.items} />
      </main>
    </PageFrame>
  );
}
