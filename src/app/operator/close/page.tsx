import { OperatorChecklist } from "@/app/operator/_components/operator-checklist";
import { OperatorText } from "@/app/operator/_components/operator-language";
import { getTodaysChecklistState } from "@/lib/server/ops-capture";
import { getDayPaymentPicture } from "@/lib/server/payment-truth";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorClosePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [state, picture] = await Promise.all([
    getTodaysChecklistState(branchId, "closing"),
    getDayPaymentPicture(branchId),
  ]);
  return (
    <div data-testid="operator-close-page">
      <OperatorText as="p" className="eyebrow text-[var(--brand)]" k="page.close.eyebrow" />
      <OperatorText as="h1" className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]" k="page.close.title" />
      <OperatorText as="p" className="mt-2 text-lg text-[var(--muted)]" k="page.close.helper" />

      <div className="mt-6">
        <OperatorChecklist
          branchId={branchId}
          kind="closing"
          initialSessionId={state.sessionId}
          initialSummary={state.summary}
          initialReceipt={state.receipt}
          moneyPicture={picture}
        />
      </div>
    </div>
  );
}
