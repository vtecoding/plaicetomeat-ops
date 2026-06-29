import "server-only";

import { getInventoryBatches } from "@/lib/server/compliance-inventory";
import type { DeliveryHistoryEntry } from "@/lib/operator/workflows/delivery-defaults";
import { resolveOpeningFloatDefault, type FloatDefault } from "@/lib/operator/workflows/float-default";
import { businessDateUtc } from "@/lib/server/ops-capture";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Branch-scoped delivery history for confirm-don't-ask defaults: one entry per prior
 * inventory batch with the fields the pure resolver needs. Read-only; computing the
 * actual defaults stays in the pure helper so it can be unit-tested in isolation.
 */
export async function getDeliveryHistory(branchId: string): Promise<DeliveryHistoryEntry[]> {
  const batches = await getInventoryBatches(branchId);
  return batches.map((batch) => ({
    productId: batch.productId,
    supplierId: batch.supplierId,
    storageLabel: batch.storageLocation,
    receivedDate: batch.receivedDate,
    expiryDate: batch.expiryDate,
  }));
}

/**
 * The suggested opening float, drawn from the most recent completed opening session's
 * recorded float. PTM's closing step is a counted total (float + takings), not a float
 * base, so we pass null for the close source and let yesterday's opening float be the
 * truthful predictor. Branch default float is not configured anywhere yet (null).
 */
export async function getOpeningFloatDefault(branchId: string, now = new Date()): Promise<FloatDefault> {
  const lastOpenFloatGbp = await getLastOpeningFloatGbp(branchId, now);
  return resolveOpeningFloatDefault({
    lastCloseFloatGbp: null,
    lastOpenFloatGbp,
    branchDefaultFloatGbp: null,
  });
}

async function getLastOpeningFloatGbp(branchId: string, now: Date): Promise<number | null> {
  const supabase = await createSupabaseServerClient();

  // Recent completed opening rituals before today, newest first. We scan a few because
  // the float step is optional — the latest open may not have recorded one.
  const { data: sessions } = await supabase
    .from("ops_checklist_sessions")
    .select("id")
    .eq("branch_id", branchId)
    .eq("kind", "opening")
    .eq("status", "completed")
    .lt("business_date", businessDateUtc(now))
    .order("business_date", { ascending: false })
    .limit(5);

  for (const session of sessions ?? []) {
    const { data: event } = await supabase
      .from("ops_checklist_events")
      .select("payload")
      .eq("session_id", String(session.id))
      .eq("step_key", "float_ready")
      .eq("state", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const value = (event?.payload as { value?: unknown } | null)?.value;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }

  return null;
}
