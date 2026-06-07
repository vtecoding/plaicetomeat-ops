import { GuidedChecklist } from "@/components/ops-capture/guided-checklist";
import { PageFrame } from "@/components/site-header";
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
        <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">{kind === "opening" ? "Start of day" : "End of day"}</p>
          <h1 className="mt-2 text-3xl font-black">{def.title}</h1>
          <p className="mt-2 text-sm font-semibold text-[#6c5e52]">{def.intro}</p>
        </header>

        <div className="mt-4">
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
