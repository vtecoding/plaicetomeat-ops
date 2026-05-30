import "server-only";

import { cache } from "react";

import type { StaffRole } from "@/lib/domain/route-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StaffProfile = {
  id: string;
  email: string;
  fullName: string | null;
  role: StaffRole;
  branchId: string | null;
  isActive: boolean;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: StaffRole | null;
  branch_id: string | null;
  is_active: boolean | null;
};

/**
 * Returns the authenticated staff profile for the current request, or null if
 * the visitor is unauthenticated, has no profile, is deactivated, or has no
 * staff role. Deduplicated per-request with React `cache`.
 *
 * This always validates the session against Supabase Auth (`getUser`) rather
 * than trusting cookies blindly.
 */
export const getCurrentProfile = cache(async (): Promise<StaffProfile | null> => {
  let supabase;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    // Public env not configured (no Supabase) — treat as unauthenticated.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,branch_id,is_active")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (!data || !data.role || data.is_active !== true) {
    return null;
  }

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    branchId: data.branch_id,
    isActive: true,
  };
});
