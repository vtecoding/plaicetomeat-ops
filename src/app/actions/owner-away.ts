"use server";

import { revalidatePath } from "next/cache";

import { composeOwnerDigest, getOwnerContact } from "@/lib/server/alert-dispatch";
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
  let businessDate: string | null = null;
  let target = "";
  let payload: Record<string, unknown> = {};
  if (input.ownerAway) {
    const { data: date, error: dateError } = await supabase.rpc("branch_business_date", {
      p_branch_id: ctx.branchId,
      p_at: new Date().toISOString(),
    });
    if (dateError || !date) return { ok: false, message: "Could not prepare the first Owner Away update." };
    businessDate = String(date);
    try {
      [target, payload] = await Promise.all([
        getOwnerContact(ctx.branchId).then((value) => value ?? ""),
        composeOwnerDigest(ctx.branchId, businessDate).then((message) => ({ message, business_date: businessDate })),
      ]);
    } catch {
      return { ok: false, message: "Could not prepare the first Owner Away update." };
    }
  }

  const { data, error } = await supabase.rpc("set_owner_away_mode_with_digest_v18", {
    p_branch_id: ctx.branchId,
    p_owner_away: input.ownerAway,
    p_updated_by: ctx.profile.id,
    p_business_date: businessDate,
    p_target: target,
    p_payload: payload,
  });

  const state = data as { owner_away?: boolean; away_since?: string | null; changed?: boolean; digest_id?: string | null } | null;
  if (error || state?.owner_away !== input.ownerAway) {
    return { ok: false, message: "Could not update Owner Away Mode." };
  }
  if (input.ownerAway && (!state.away_since || !state.digest_id)) {
    return { ok: false, message: "Could not start Owner Away with its first phone update." };
  }

  revalidateOwnerAway();
  return { ok: true, message: input.ownerAway ? "Owner Away is on." : "Owner Away is off." };
}
