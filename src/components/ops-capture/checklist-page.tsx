import { GuidedChecklist } from "@/components/ops-capture/guided-checklist";
import { PageFrame } from "@/components/site-header";
import { Masthead } from "@/components/ui/page";
import { getChecklist } from "@/lib/ops-capture/checklists";
import { getTodaysChecklistState, type ChecklistKind } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";

/** Shared server shell for the opening and closing ritual screens. */
export async function ChecklistPage({ kind, testid }: { kind: ChecklistKind; testid: string }) {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const state = await getTodaysChecklistState(branchId, kind);
  const def = getChecklist(kind);

  return (
    <PageFrame>
      <main className="mx-auto max-w-2xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid={testid}>
        <Masthead eyebrow={kind === "opening" ? "Start of day" : "End of day"} title={def.title} subtitle={def.intro} />

        <div className="mt-6">
          <GuidedChecklist
            branchId={branchId}
            kind={kind}
            initialSessionId={state.sessionId}
            initialSummary={state.summary}
            initialReceipt={state.receipt}
          />
        </div>
      </main>
    </PageFrame>
  );
}
