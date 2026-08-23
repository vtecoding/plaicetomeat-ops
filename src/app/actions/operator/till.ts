"use server";

import { revalidatePath } from "next/cache";

import { isUuid, simpleText, type OperatorActionResult } from "@/app/actions/operator/escalation";
import { assertProductionMutationAllowed, type ExecutionContext } from "@/lib/operator/execution-context";
import { requireShopDayAction } from "@/lib/server/shop-day";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// V18 A1 (PTM-OPS-001, decision D-9): recorded drawer movements outside sales
// and refunds — change added, a supplier paid from the till, owner taking cash.
// The durable record is the append-only till_events row itself: the RPC is
// retry-safe by key, so no separate workflow-run row is needed. These rows are
// part of the expected-cash equation the closing count reconciles against.

export type TillReasonCode = "change" | "supplier" | "owner" | "other";

const REASON_CODES: TillReasonCode[] = ["change", "supplier", "owner", "other"];

export async function recordTillMovement(input: {
  runId: string;
  direction: "in" | "out";
  amountGbp: number;
  reasonCode: TillReasonCode;
  note?: string | null;
  executionContext?: ExecutionContext;
}): Promise<OperatorActionResult> {
  assertProductionMutationAllowed(input.executionContext, "operator-record-till-movement");
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (!isUuid(input.runId)) return { ok: false, message: "Go back and try again." };

  if (input.direction !== "in" && input.direction !== "out") {
    return { ok: false, message: "Is money going in or out?" };
  }
  if (!REASON_CODES.includes(input.reasonCode)) {
    return { ok: false, message: "What was the money for?" };
  }

  const amountGbp = Number(input.amountGbp);
  if (!Number.isFinite(amountGbp) || amountGbp <= 0 || amountGbp > 10000) {
    return { ok: false, message: "How much money?" };
  }

  const shopDay = await requireShopDayAction(ctx.branchId, "count_till");
  if (!shopDay.ok) return { ok: false, message: shopDay.message };

  const amountPence = Math.round(amountGbp * 100) * (input.direction === "in" ? 1 : -1);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_till_event", {
    p_branch_id: ctx.branchId,
    p_kind: input.direction === "in" ? "paid_in" : "paid_out",
    p_amount_pence: amountPence,
    p_reason_code: input.reasonCode,
    p_idempotency_key: `operator-till:${input.runId}`,
    p_note: simpleText(input.note, 200),
  });

  if (error) {
    return { ok: false, message: "This did not save. Try again." };
  }

  revalidatePath("/operator");
  revalidatePath("/operator/close");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/close");

  return { ok: true, message: "Saved.", id: input.runId };
}
