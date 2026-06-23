"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { createOwnerAlert, simpleText, type OperatorActionResult } from "@/app/actions/operator/escalation";
import {
  buildHelpSummary,
  helpProblemChoice,
  helpProblemSeverity,
  type HelpProblemId,
} from "@/lib/operator/workflows/help";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { hasSupabaseServiceEnv } from "@/lib/supabase/server";

// V17 · Operator "Help / Call owner" adapter.
//
// The operator's panic button. One tap tells the owner something is wrong by
// writing a durable owner alert (the same inbox the owner reads in their
// "while you were away" summary). A fridge/freezer problem is flagged urgent so
// it reaches the owner even when they are present. The operator is never blamed
// and never blocked — they always get a calm "the owner has been told".

export async function tellOwner(input: { problem: string; note?: string | null }): Promise<OperatorActionResult> {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Try again." };

  const problem = helpProblemChoice(input.problem).id as HelpProblemId;
  const note = simpleText(input.note, 200);
  const summary = buildHelpSummary(problem, note);

  const id = await createOwnerAlert({
    branchId: ctx.branchId,
    profileId: ctx.profile.id,
    kind: "operator_help",
    summary,
    entityRef: randomUUID(),
    severity: helpProblemSeverity(problem),
    metadata: { problem, note: note ?? null },
  });

  if (!id) return { ok: false, message: "Could not send. Try again." };

  revalidatePath("/admin");
  revalidatePath("/admin/today");

  return { ok: true, message: "Done. The owner has been told.", id, needsOwner: true };
}
