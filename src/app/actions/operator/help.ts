"use server";

import { revalidatePath } from "next/cache";
import { simpleText, type OperatorActionResult } from "@/app/actions/operator/escalation";
import {
  helpProblemChoice,
  isHelpOperationId,
  type HelpProblemId,
} from "@/lib/operator/workflows/help";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient, hasSupabasePublicEnv } from "@/lib/supabase/server";

// V17 · Operator "Help / Call owner" adapter.
//
// The operator's panic button. One tap tells the owner something is wrong by
// writing a durable owner alert (the same inbox the owner reads in their
// "while you were away" summary). A fridge/freezer problem is flagged urgent so
// it reaches the owner even when they are present. The operator is never blamed
// and never blocked — they always get a calm "the owner has been told".

export async function tellOwner(input: { operationId: string; problem: string; note?: string | null }): Promise<OperatorActionResult> {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (!hasSupabasePublicEnv()) return { ok: false, message: "Try again." };
  if (!isHelpOperationId(input.operationId)) return { ok: false, message: "Try again." };

  const problem = helpProblemChoice(input.problem).id as HelpProblemId;
  const note = simpleText(input.note, 200);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_operator_help_alert_v18", {
    p_operation_id: input.operationId,
    p_problem: problem,
    p_note: note,
  });
  const result = data as { id?: string } | null;

  if (error || !result?.id) {
    return {
      ok: false,
      message: error?.message.toLowerCase().includes("different details")
        ? "This request was already sent. Start a new help request."
        : "Could not send. Try again.",
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/today");

  return { ok: true, message: "Done. The owner has been told.", id: result.id, needsOwner: true };
}
