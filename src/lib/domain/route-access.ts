export const STAFF_SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export type StaffRole = "staff" | "manager" | "owner";

const STAFF_ROUTES = ["/counter", "/compliance"] as const;
const MANAGER_ROUTES = ["/admin"] as const;

export function isStaffFacingPath(pathname: string) {
  return [...STAFF_ROUTES, ...MANAGER_ROUTES].some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function canAccessStaffPath(role: StaffRole | null | undefined, pathname: string) {
  if (!role) {
    return false;
  }

  if (role === "owner") {
    return true;
  }

  if (MANAGER_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return role === "manager";
  }

  if (STAFF_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
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
