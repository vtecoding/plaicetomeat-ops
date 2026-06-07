"use server";

import { revalidatePath } from "next/cache";

import { log } from "@/lib/server/observability/log";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  complianceCompletionSchema,
  complianceReadingSchema,
  type ComplianceCompletionInput,
  type ComplianceReadingInput,
} from "@/lib/validation/compliance";

type ActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

// Plain-English RPC error fragments that are safe to surface verbatim.
const SAFE_PATTERNS = [
  "Not authorised",
  "Not authenticated",
  "Unknown reading type",
  "Chiller and freezer temperatures are required",
  "Temperature reading is out of range",
  "No compliance log to complete",
  "Add an opening and a closing temperature reading before completing",
  "Cleaning, sanitisation, and waste checks must all be completed",
];

function safeMessage(raw: string | undefined, fallback: string): string {
  if (raw && SAFE_PATTERNS.some((pattern) => raw.includes(pattern))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

export async function recordComplianceReading(input: ComplianceReadingInput): Promise<ActionResult> {
  const parsed = complianceReadingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the temperature details." };
  }

  // Branch-scoped staff authority: the caller must be staff of THIS branch.
  const ctx = await resolveStaffContext("staff", { branchScoped: true });
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (ctx.branchId !== parsed.data.branchId) {
    return { ok: false, message: "Not authorised for this branch." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_compliance_reading", {
    p_branch_id: parsed.data.branchId,
    p_reading_type: parsed.data.readingType,
    p_chiller_temp_c: parsed.data.chillerTempC,
    p_freezer_temp_c: parsed.data.freezerTempC,
    p_display_temp_c: parsed.data.displayTempC ?? null,
  });

  if (error) {
    log("OPS_CAPTURE", "warn", "compliance reading rejected", { branchId: parsed.data.branchId, error: error.message });
    return { ok: false, message: safeMessage(error.message, "Could not save this reading.") };
  }

  log("OPS_CAPTURE", "info", "compliance reading recorded", {
    branchId: parsed.data.branchId,
    readingType: parsed.data.readingType,
  });
  revalidatePath("/counter/compliance");
  return { ok: true, message: "Reading recorded.", id: String(data) };
}

export async function completeComplianceDay(input: ComplianceCompletionInput): Promise<ActionResult> {
  const parsed = complianceCompletionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the completion details." };
  }

  const ctx = await resolveStaffContext("staff", { branchScoped: true });
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (ctx.branchId !== parsed.data.branchId) {
    return { ok: false, message: "Not authorised for this branch." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_compliance_log", {
    p_branch_id: parsed.data.branchId,
    p_cleaning_completed: parsed.data.cleaningCompleted,
    p_sanitisation_completed: parsed.data.sanitisationCompleted,
    p_waste_checked: parsed.data.wasteChecked,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    log("OPS_CAPTURE", "warn", "compliance completion rejected", { branchId: parsed.data.branchId, error: error.message });
    return { ok: false, message: safeMessage(error.message, "Could not complete the daily log.") };
  }

  log("OPS_CAPTURE", "info", "compliance day completed", { branchId: parsed.data.branchId });
  revalidatePath("/counter/compliance");
  return { ok: true, message: "Daily log completed.", id: String(data) };
}
