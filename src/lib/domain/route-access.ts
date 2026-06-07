export const STAFF_SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export type StaffRole = "staff" | "manager" | "owner";

/** Roles allowed to use the manager/owner admin console. */
export const MANAGER_ROLES: StaffRole[] = ["manager", "owner"];

/**
 * Ordered privilege ranking. Higher number = more authority. Used by
 * `hasMinRole` so the single authority path (`requireStaffContext`) can express
 * "at least manager" / "owner only" without scattering role-array literals.
 */
export const ROLE_RANK: Record<StaffRole, number> = {
  staff: 1,
  manager: 2,
  owner: 3,
};

/**
 * True when `role` meets or exceeds `minRole`. Owner-global access is therefore
 * explicit (owner outranks everything) rather than accidental, and a missing
 * role always fails closed.
 */
export function hasMinRole(role: StaffRole | null | undefined, minRole: StaffRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/**
 * Branch isolation: a non-owner may only act on their own, non-null branch. The
 * owner is branch-global. A null profile branch (or any mismatch) fails closed,
 * so branch A can never reach branch B.
 */
export function isBranchAuthorised(
  role: StaffRole,
  profileBranchId: string | null,
  targetBranchId: string,
): boolean {
  if (role === "owner") return true;
  return profileBranchId != null && profileBranchId === targetBranchId;
}

const STAFF_ROUTES = ["/counter"] as const;
const MANAGER_ROUTES = ["/admin"] as const;

/**
 * Sensitive back-office areas restricted to the owner only — managers can run the
 * shop but not the deployment/audit tooling. Counter staff never reach /admin at all.
 */
const OWNER_ONLY_ROUTES = ["/admin/releases", "/admin/audit"] as const;

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isStaffFacingPath(pathname: string) {
  return [...STAFF_ROUTES, ...MANAGER_ROUTES].some((route) => matchesRoute(pathname, route));
}

/** True if a route is restricted to the owner role. */
export function isOwnerOnlyPath(pathname: string) {
  return OWNER_ONLY_ROUTES.some((route) => matchesRoute(pathname, route));
}

export function canAccessStaffPath(role: StaffRole | null | undefined, pathname: string) {
  if (!role) {
    return false;
  }

  // Owner-only areas are checked first so even the owner-returns-true shortcut
  // can't accidentally widen access for managers.
  if (isOwnerOnlyPath(pathname)) {
    return role === "owner";
  }

  if (role === "owner") {
    return true;
  }

  if (MANAGER_ROUTES.some((route) => matchesRoute(pathname, route))) {
    return role === "manager";
  }

  if (STAFF_ROUTES.some((route) => matchesRoute(pathname, route))) {
    return role === "staff" || role === "manager";
  }

  return true;
}
