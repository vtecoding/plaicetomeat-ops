"use server";

import { revalidatePath } from "next/cache";

import { resolveSystemCut, type PricingValidationDecision, type SpeciesId } from "@/lib/butchery/pricing-validation";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

const SAFE_PATTERNS = [
  "Not authorised",
  "Not authenticated",
  "Unknown species",
  "Unknown decision",
  "Cut is required",
  "Enter the butcher yield and price",
  "Butcher figures are out of range",
];

function safeMessage(raw: string | undefined, fallback: string) {
  if (raw && SAFE_PATTERNS.some((pattern) => raw.includes(pattern))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

async function requireManager(): Promise<{ ok: true; branchId: string } | { ok: false; message: string }> {
  const ctx = await resolveStaffContext("manager", { branchScoped: true });
  return ctx.ok ? { ok: true, branchId: ctx.branchId } : { ok: false, message: ctx.message };
}

export async function recordPricingValidation(input: {
  species: SpeciesId;
  cutId: string;
  // The butcher's own assumptions for this species (legitimately human input). The
  // system snapshot is derived from these server-side — never sent by the client.
  carcassWeightKg: number;
  carcassCost: number;
  butcherYieldPct: number | null;
  butcherPricePerKg: number | null;
  decision: PricingValidationDecision;
  notes?: string | null;
  butcherName?: string | null;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  // PTM is the sole author of its own recommendation. The client supplies only the
  // butcher's carcass assumptions and verdict; the server recomputes the yield / cost
  // / price / margin snapshot (and the cut name) itself, so an audit record can never
  // carry "system" figures the client invented. This closes the duplication/integrity
  // gap flagged in the Information Necessity Audit (Dup1).
  const system = resolveSystemCut({
    species: input.species,
    cutId: input.cutId,
    carcassWeightKg: Number(input.carcassWeightKg),
    carcassCost: Number(input.carcassCost),
  });
  if (!system) {
    return { ok: false, message: "Enter a valid carcass weight and cost for this cut before saving." };
  }

  // The page is single-branch (the manager's own branch); never trust a client branch id.
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_pricing_validation", {
    p_branch_id: auth.branchId,
    p_species: input.species,
    p_cut_id: input.cutId,
    p_cut_name: system.cutName,
    p_system_yield_pct: system.yieldPct,
    p_system_cost_per_kg: system.costPerKgSaleable,
    p_system_price_per_kg: system.suggestedPricePerKg,
    p_system_margin_pct: system.marginPct,
    p_butcher_yield_pct: input.butcherYieldPct,
    p_butcher_price_per_kg: input.butcherPricePerKg,
    p_decision: input.decision,
    p_notes: input.notes ?? null,
    p_butcher_name: input.butcherName ?? null,
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not save this sign-off.") };
  revalidatePath("/admin/validation/pricing");
  return { ok: true, message: "Sign-off saved.", id: String(data) };
}
