import { OperatorChecklist, type NumberPrefill } from "@/app/operator/_components/operator-checklist";
import { OperatorText } from "@/app/operator/_components/operator-language";
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
      ? { float_ready: { value: floatDefault.valueGbp, source: floatDefault.source } }
      : {};

  return (
    <div data-testid="operator-open-page">
      <OperatorText as="p" className="eyebrow text-[var(--brand)]" k="page.open.eyebrow" />
      <OperatorText as="h1" className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em]" k="page.open.title" />
      <OperatorText as="p" className="mt-2 text-lg text-[var(--muted)]" k="page.open.helper" />

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
