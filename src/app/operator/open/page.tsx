import { OperatorChecklist } from "@/app/operator/_components/operator-checklist";
import { getTodaysChecklistState } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorOpenPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const state = await getTodaysChecklistState(branchId, "opening");

  return (
    <div data-testid="operator-open-page">
      <p className="eyebrow text-[var(--brand)]">Start of day</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]">Open the shop</h1>
      <p className="mt-2 text-lg text-[var(--muted)]">A few checks, one at a time.</p>

      <div className="mt-6">
        <OperatorChecklist
          branchId={branchId}
          kind="opening"
          initialSessionId={state.sessionId}
          initialSummary={state.summary}
          initialReceipt={state.receipt}
        />
      </div>
    </div>
  );
}
