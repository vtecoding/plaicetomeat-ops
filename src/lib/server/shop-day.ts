import "server-only";

import { canPerformShopDayAction, deriveShopDayPhase, shopDayActionInstruction, type ShopDayAction, type ShopDayPhase, type ShopDayRitualStatus } from "@/lib/domain/shop-day";
import { getBranchBusinessDate } from "@/lib/server/payment-truth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PersistedShopDay = {
  branchId: string;
  businessDate: string;
  phase: ShopDayPhase;
  openingStatus: ShopDayRitualStatus;
  closingStatus: ShopDayRitualStatus;
};

type RitualRow = {
  kind: "opening" | "closing";
  status: Exclude<ShopDayRitualStatus, null>;
  started_at: string;
};

/**
 * Read one branch-local shop day from existing persisted ritual truth. This is a
 * composition boundary, not a second operational ledger.
 */
export async function getPersistedShopDay(branchId: string, now = new Date()): Promise<PersistedShopDay> {
  const supabase = await createSupabaseServerClient();
  const businessDate = await getBranchBusinessDate(branchId, now);

  const { data, error } = await supabase
    .from("ops_checklist_sessions")
    .select("kind,status,started_at")
    .eq("branch_id", branchId)
    .eq("business_date", businessDate)
    .in("kind", ["opening", "closing"])
    .order("started_at", { ascending: false });

  if (error) {
    throw new Error("PTM could not check the shop day right now.");
  }

  const rows = (data ?? []) as RitualRow[];
  const openingStatus = rows.find((row) => row.kind === "opening")?.status ?? null;
  const closingStatus = rows.find((row) => row.kind === "closing")?.status ?? null;
  const derived = deriveShopDayPhase({ openingStatus, closingStatus });

  if (!derived.ok) {
    throw new Error("The recorded shop day is inconsistent and needs an owner review.");
  }

  return { branchId, businessDate, phase: derived.phase, openingStatus, closingStatus };
}

export type ShopDayActionPermission =
  | { ok: true; shopDay: PersistedShopDay }
  | { ok: false; message: string; shopDay: PersistedShopDay | null };

/** Server-side gate used by every Operator trading mutation. */
export async function requireShopDayAction(
  branchId: string,
  action: ShopDayAction,
): Promise<ShopDayActionPermission> {
  try {
    const shopDay = await getPersistedShopDay(branchId);
    if (canPerformShopDayAction(shopDay.phase, action)) return { ok: true, shopDay };
    return {
      ok: false,
      message: shopDayActionInstruction(shopDay.phase) ?? "This shop work is not available right now.",
      shopDay,
    };
  } catch {
    return { ok: false, message: "PTM could not check the shop day. Nothing was saved. Try again.", shopDay: null };
  }
}
