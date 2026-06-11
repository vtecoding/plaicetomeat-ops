import { redirect } from "next/navigation";

import { GuidedDay } from "@/components/owner-brain/guided-day";
import { PageFrame } from "@/components/site-header";
import { buildDayShape } from "@/lib/owner-brain/brain";
import { getOwnerBrain } from "@/lib/server/owner-brain";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

/**
 * V10 — "Walk me through it". The optional guided morning. Defaults stay on the Today
 * list; this route is for the owner who wants a hand held through the day one item at a
 * time (or who's just back after time away). While the shop is still being set up there's
 * nothing to walk, so we send them back to the Getting Started steps.
 */
export default async function WalkPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const brain = await getOwnerBrain(branchId);

  if (brain.setupMode) {
    redirect("/admin/today");
  }

  const day = buildDayShape(brain.walkSteps);

  return (
    <PageFrame>
      <main className="mx-auto max-w-2xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="guided-walk">
        <header className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-sm">
          <p className="eyebrow text-[var(--brand)]">Let&apos;s get the shop ready</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-[var(--ink)]">{day.headline}</h1>
        </header>

        <div className="mt-4">
          <GuidedDay steps={day.steps} opportunityCount={brain.opportunityCount} />
        </div>
      </main>
    </PageFrame>
  );
}
