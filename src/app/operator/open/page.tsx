import { OperatorChecklist, type NumberPrefill } from "@/app/operator/_components/operator-checklist";
import { getOpeningFloatDefault } from "@/lib/server/operator-defaults";
import { getTodaysChecklistState } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function OperatorOpenPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [state, floatDefault] = await Promise.all([
    getTodaysChecklistState(branchId, "opening"),
    getOpeningFloatDefault(branchId),
  ]);

  // Confirm-don't-ask: prefill the opening float from the last opening float so the
  // operator confirms "£50?" instead of typing it again. Never silently saved — the
  // value sits in an editable field that still needs an explicit "Save".
  const numberPrefills: Record<string, NumberPrefill> =
    floatDefault.valueGbp !== null
      ? { float_ready: { value: floatDefault.valueGbp, hint: `Use yesterday's float: £${floatDefault.valueGbp}?`, source: floatDefault.source } }
      : {};

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
          numberPrefills={numberPrefills}
        />
      </div>
    </div>
  );
}
