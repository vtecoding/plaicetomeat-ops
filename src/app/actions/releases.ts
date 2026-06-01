"use server";

import { revalidatePath } from "next/cache";

import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

async function requireManager(): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!MANAGER_ROLES.includes(profile.role)) return { ok: false, message: "Only managers and owners can do this." };
  return { ok: true };
}

function safeMessage(raw: string | undefined, fallback: string) {
  if (raw?.includes("Post release verification") || raw?.includes("Not authorised") || raw?.includes("Invalid")) {
    return raw.replace(/\.$/, "") + ".";
  }

  return fallback;
}

export async function updateReleaseVerificationItem(input: {
  itemId: string;
  status: "pending" | "passed" | "failed";
  notes?: string;
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_release_verification_item", {
    p_item_id: input.itemId,
    p_status: input.status,
    p_notes: input.notes ?? "",
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not update verification item.") };
  revalidatePath("/admin/releases");
  return { ok: true, message: "Verification updated.", id: String(data) };
}

export async function certifyRelease(input: {
  releaseId: string;
  hostedSmokeResult: "pending" | "passed" | "failed";
  releaseReportResult: "pending" | "passed" | "failed";
}): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("certify_release", {
    p_release_id: input.releaseId,
    p_hosted_smoke_result: input.hostedSmokeResult,
    p_release_report_result: input.releaseReportResult,
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not certify this release.") };
  revalidatePath("/admin/releases");
  return { ok: true, message: "Release certification recorded.", id: String(data) };
}
