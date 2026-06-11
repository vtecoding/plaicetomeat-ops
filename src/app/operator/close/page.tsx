import { OperatorChecklist } from "@/app/operator/_components/operator-checklist";
import { getTodaysChecklistState } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorClosePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const state = await getTodaysChecklistState(branchId, "closing");

  return (
    <div data-testid="operator-close-page">
      <p className="eyebrow text-[var(--brand)]">End of day</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]">Close the shop</h1>
      <p className="mt-2 text-lg text-[var(--muted)]">Lock up safely. One step at a time.</p>

      <div className="mt-6">
        <OperatorChecklist
          branchId={branchId}
          kind="closing"
          initialSessionId={state.sessionId}
          initialSummary={state.summary}
          initialReceipt={state.receipt}
        />
      </div>
    </div>
  );
}
