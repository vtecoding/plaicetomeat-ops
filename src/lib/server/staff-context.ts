import "server-only";

import { redirect } from "next/navigation";

import { hasMinRole, type StaffRole } from "@/lib/domain/route-access";
import { getCurrentProfile, type StaffProfile } from "@/lib/server/auth";

// V12.2 — the single staff/admin authority path.
//
// Every admin/staff route and every privileged server action resolves authority
// through here. There is no branch fallback: a branch-scoped surface requires a
// real, non-null branchId and fails closed otherwise. Owner-global access is
// explicit via `minRole: "owner"`. `resolveStaffContext` returns a typed verdict
// (for server actions that surface messages); `requireStaffContext` redirects on
// failure (for server pages/components).

export type StaffContextRefusal = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "no_branch";
  message: string;
};

export type StaffContextOptions = { branchScoped?: boolean };

function forbiddenMessage(minRole: StaffRole): string {
  return minRole === "owner"
    ? "Only the owner can open this."
    : "Only managers and owners can do this.";
}

// --- resolve (no redirect; for server actions) ------------------------------

export async function resolveStaffContext(
  minRole: StaffRole,
  options: { branchScoped: true },
): Promise<StaffContextRefusal | { ok: true; profile: StaffProfile; branchId: string }>;
export async function resolveStaffContext(
  minRole: StaffRole,
  options?: { branchScoped?: false },
): Promise<StaffContextRefusal | { ok: true; profile: StaffProfile; branchId: string | null }>;
export async function resolveStaffContext(
  minRole: StaffRole,
  options: StaffContextOptions = {},
): Promise<StaffContextRefusal | { ok: true; profile: StaffProfile; branchId: string | null }> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: "Your session has expired. Please sign in again.",
    };
  }

  if (!hasMinRole(profile.role, minRole)) {
    return { ok: false, reason: "forbidden", message: forbiddenMessage(minRole) };
  }

  if (options.branchScoped && !profile.branchId) {
    return {
      ok: false,
      reason: "no_branch",
      message: "No branch is assigned to this account. Ask the owner to set your branch before using this screen.",
    };
  }

  return { ok: true, profile, branchId: profile.branchId };
}

// --- require (redirects; for server pages/components) -----------------------

export async function requireStaffContext(
  minRole: StaffRole,
  options: { branchScoped: true },
): Promise<{ profile: StaffProfile; branchId: string }>;
export async function requireStaffContext(
  minRole: StaffRole,
  options?: { branchScoped?: false },
): Promise<{ profile: StaffProfile; branchId: string | null }>;
export async function requireStaffContext(
  minRole: StaffRole,
  options: StaffContextOptions = {},
): Promise<{ profile: StaffProfile; branchId: string | null }> {
  const result = await resolveStaffContext(minRole, options as { branchScoped: true });

  if (!result.ok) {
    if (result.reason === "unauthenticated") {
      redirect("/login");
    }
    redirect("/unauthorised");
  }

  return { profile: result.profile, branchId: result.branchId };
}
