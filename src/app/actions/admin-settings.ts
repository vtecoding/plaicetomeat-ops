"use server";

import { revalidatePath } from "next/cache";

import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { validateReadySmsTemplate } from "@/lib/domain/sms";
import { getCurrentProfile } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminSettingsResult = { ok: true; message: string } | { ok: false; message: string };

const SAFE_MESSAGE_PATTERNS = [
  "Not authenticated",
  "Not authorised",
  "Branch address is required",
  "SMS template is required",
  "Unsupported SMS placeholder",
  "Cancellation window must be",
];

function safeMessage(raw: string | undefined, fallback: string): string {
  if (raw && SAFE_MESSAGE_PATTERNS.some((pattern) => raw.includes(pattern))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

async function requireManager(): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!MANAGER_ROLES.includes(profile.role)) return { ok: false, message: "Only managers and owners can update settings." };
  return { ok: true };
}

export async function updateBranchSettings(input: {
  branchId: string;
  address: string;
  smsReadyTemplate: string;
  cancellationWindowMinutes: number;
}): Promise<AdminSettingsResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  if (!input.address.trim()) return { ok: false, message: "Branch address is required." };
  if (!input.smsReadyTemplate.trim()) return { ok: false, message: "SMS template is required." };
  if (!Number.isInteger(input.cancellationWindowMinutes) || input.cancellationWindowMinutes < 0) {
    return { ok: false, message: "Cancellation window must be zero minutes or greater." };
  }

  const validation = validateReadySmsTemplate(input.smsReadyTemplate);
  if (!validation.ok) {
    return { ok: false, message: `Unsupported SMS placeholder: {${validation.unsupported[0]}}.` };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_branch_settings", {
    p_branch_id: input.branchId,
    p_address: input.address,
    p_sms_ready_template: input.smsReadyTemplate,
    p_cancellation_window_minutes: input.cancellationWindowMinutes,
  });

  if (error) return { ok: false, message: safeMessage(error.message, "Could not update branch settings.") };

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  revalidatePath("/checkout");
  return { ok: true, message: "Branch settings updated." };
}
