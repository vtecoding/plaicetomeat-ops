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
 * V17 Operator Mode. The single guided front door for a low-tech co-owner.
 * Reachable by manager/owner rank; an `operator_mode` account is *locked* to it
 * (see `canAccessStaffPath`). Authority rank is unchanged — operator adapters
 * still resolve as `manager` — this only selects the simple surface.
 */
const OPERATOR_ROUTES = ["/operator"] as const;

/**
 * Sensitive back-office areas restricted to the owner only — managers can run the
 * shop but not the deployment/audit tooling. Counter staff never reach /admin at all.
 */
const OWNER_ONLY_ROUTES = ["/admin/releases", "/admin/audit", "/admin/away"] as const;

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isStaffFacingPath(pathname: string) {
  return [...STAFF_ROUTES, ...MANAGER_ROUTES, ...OPERATOR_ROUTES].some((route) =>
    matchesRoute(pathname, route),
  );
}

/** True if a route is restricted to the owner role. */
export function isOwnerOnlyPath(pathname: string) {
  return OWNER_ONLY_ROUTES.some((route) => matchesRoute(pathname, route));
}

/** True for an operator-locked account: a non-owner with the operator_mode flag. */
export function isOperatorAccount(
  role: StaffRole | null | undefined,
  operatorMode: boolean | null | undefined,
): boolean {
  return operatorMode === true && hasMinRole(role, "manager") && role !== "owner";
}

export type StaffPathOptions = { operatorMode?: boolean };

export function canAccessStaffPath(
  role: StaffRole | null | undefined,
  pathname: string,
  options: StaffPathOptions = {},
) {
  if (!role) {
    return false;
  }

  const isOperatorPath = OPERATOR_ROUTES.some((route) => matchesRoute(pathname, route));

  // Operator-locked accounts can ONLY reach Operator Mode — never /admin or
  // /counter. This is checked first so the flag is an absolute boundary that the
  // owner-returns-true shortcut below can never widen.
  if (isOperatorAccount(role, options.operatorMode)) {
    return isOperatorPath;
  }

  // Operator Mode itself is a manager/owner surface (e.g. the owner previewing it).
  // Plain counter staff never reach it.
  if (isOperatorPath) {
    return hasMinRole(role, "manager");
  }

  // Owner-only areas are checked next so even the owner-returns-true shortcut
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
