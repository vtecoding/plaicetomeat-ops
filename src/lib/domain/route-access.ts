export const STAFF_SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export type StaffRole = "staff" | "manager" | "owner";

/** Roles allowed to use the manager/owner admin console. */
export const MANAGER_ROLES: StaffRole[] = ["manager", "owner"];

const STAFF_ROUTES = ["/counter", "/compliance"] as const;
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

export function isStaffSessionExpired(lastSeen: string | undefined, now = Date.now()) {
  if (!lastSeen) {
    return false;
  }

  const lastSeenTime = Number(lastSeen);

  if (!Number.isFinite(lastSeenTime)) {
    return true;
  }

  return now - lastSeenTime > STAFF_SESSION_TIMEOUT_MS;
}
