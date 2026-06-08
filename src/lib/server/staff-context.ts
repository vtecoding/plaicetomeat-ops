import "server-only";

import { redirect } from "next/navigation";

import { SECURITY_REASON } from "@/lib/domain/security-events";
import { hasMinRole, isBranchAuthorised, type StaffRole } from "@/lib/domain/route-access";
import { getCurrentProfile, type StaffProfile } from "@/lib/server/auth";
import { recordSecurityEvent } from "@/lib/server/security-audit";

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
    await recordSecurityEvent({
      reason: SECURITY_REASON.AUTHORITY_DENIED_ROLE,
      targetType: "authority",
      targetId: profile.id,
      branchId: profile.branchId,
      metadata: { role: profile.role, requiredRole: minRole },
    });
    return { ok: false, reason: "forbidden", message: forbiddenMessage(minRole) };
  }

  if (options.branchScoped && !profile.branchId) {
    await recordSecurityEvent({
      reason: SECURITY_REASON.AUTHORITY_DENIED_NO_BRANCH,
      targetType: "authority",
      targetId: profile.id,
      metadata: { role: profile.role, requiredRole: minRole },
    });
    return {
      ok: false,
      reason: "no_branch",
      message: "No branch is assigned to this account. Ask the owner to set your branch before using this screen.",
    };
  }

  return { ok: true, profile, branchId: profile.branchId };
}

/**
 * Branch-scoped access to a SPECIFIC target branch (e.g. acting on an order in a
 * branch). Owner is branch-global; everyone else may only act on their own,
 * non-null branch. A cross-branch attempt fails closed and emits a security event.
 */
export async function resolveBranchScopedAccess(
  minRole: StaffRole,
  targetBranchId: string,
): Promise<StaffContextRefusal | { ok: true; profile: StaffProfile; branchId: string }> {
  const ctx = await resolveStaffContext(minRole);
  if (!ctx.ok) {
    return ctx;
  }

  if (!isBranchAuthorised(ctx.profile.role, ctx.profile.branchId, targetBranchId)) {
    await recordSecurityEvent({
      reason: SECURITY_REASON.AUTHORITY_DENIED_BRANCH,
      targetType: "authority",
      targetId: ctx.profile.id,
      branchId: targetBranchId,
      metadata: { role: ctx.profile.role, ownBranchId: ctx.profile.branchId },
    });
    return { ok: false, reason: "forbidden", message: "Not authorised for this branch." };
  }

  return { ok: true, profile: ctx.profile, branchId: targetBranchId };
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
