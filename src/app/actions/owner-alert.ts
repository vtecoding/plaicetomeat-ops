"use server";

import { revalidatePath } from "next/cache";

import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function acknowledgeOwnerAlert(formData: FormData): Promise<void> {
  const alertId = String(formData.get("alertId") ?? "");
  if (!UUID.test(alertId)) return;
  const ctx = await resolveStaffContext("owner", { branchScoped: true });
  if (!ctx.ok) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("acknowledge_owner_alert_v18", { p_alert_id: alertId });
  if (error) throw new Error("Could not acknowledge this owner alert.");
  revalidatePath("/admin/today");
  revalidatePath("/admin/reconcile");
}
