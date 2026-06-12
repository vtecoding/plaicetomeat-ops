"use server";

import { revalidatePath } from "next/cache";

import { emitAuditLog } from "@/lib/server/audit";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type OwnerAwayActionResult = { ok: true; message: string } | { ok: false; message: string };

function revalidateOwnerAway() {
  revalidatePath("/admin");
  revalidatePath("/admin/today");
  revalidatePath("/admin/away");
}

export async function setOwnerAwayMode(input: { ownerAway: boolean }): Promise<OwnerAwayActionResult> {
  const ctx = await resolveStaffContext("owner", { branchScoped: true });
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: "Live database is not configured." };

  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("branch_operator_settings").upsert(
    {
      branch_id: ctx.branchId,
      owner_away: input.ownerAway,
      away_since: input.ownerAway ? now : null,
      updated_at: now,
      updated_by: ctx.profile.id,
    },
    { onConflict: "branch_id" },
  );

  if (error) {
    return { ok: false, message: "Could not update Owner Away Mode." };
  }

  await emitAuditLog({
    eventType: "branch_settings_updated",
    targetType: "branch_operator_settings",
    targetId: ctx.branchId,
    branchId: ctx.branchId,
    metadata: { owner_away: input.ownerAway },
    systemReason: "owner_away_mode",
  });

  revalidateOwnerAway();
  return { ok: true, message: input.ownerAway ? "Owner Away is on." : "Owner Away is off." };
}
