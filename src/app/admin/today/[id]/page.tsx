import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DecisionDetail } from "@/components/owner-brain/decision-detail";
import { PageFrame } from "@/components/site-header";
import { getOwnerBrain } from "@/lib/server/owner-brain";
import { requireStaffContext } from "@/lib/server/staff-context";
import { findDecision } from "@/lib/owner-brain/brain";

export const dynamic = "force-dynamic";

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });

  const { id } = await params;
  const brain = await getOwnerBrain(branchId);
  const action = findDecision(brain, id);

  // The brain is rebuilt fresh each request, so an action can disappear once it's
  // resolved. Send the owner calmly back to Today rather than showing a dead end.
  if (!action) {
    redirect("/admin/today");
  }

  return (
    <PageFrame>
      <main className="mx-auto max-w-2xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="decision-card">
        <Link href="/admin/today" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132] hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to today
        </Link>

        <div className="mt-3">
          <DecisionDetail action={action} headingLevel={1} />
        </div>
      </main>
    </PageFrame>
  );
}
