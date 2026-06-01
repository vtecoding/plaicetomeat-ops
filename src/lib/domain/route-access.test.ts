import { describe, expect, it } from "vitest";

import { STAFF_SESSION_TIMEOUT_MS, canAccessStaffPath, isStaffFacingPath, isStaffSessionExpired } from "./route-access";

describe("staff route access", () => {
  it("maps staff, manager, and owner access from the V2 route rules", () => {
    expect(canAccessStaffPath(undefined, "/counter")).toBe(false);
    expect(canAccessStaffPath("staff", "/counter")).toBe(true);
    expect(canAccessStaffPath("staff", "/counter/compliance")).toBe(true);
    expect(canAccessStaffPath("staff", "/admin")).toBe(false);
    expect(canAccessStaffPath("manager", "/admin/settings")).toBe(true);
    expect(canAccessStaffPath("owner", "/admin")).toBe(true);
  });

  it("restricts release and audit tooling to the owner", () => {
    expect(canAccessStaffPath("manager", "/admin/releases")).toBe(false);
    expect(canAccessStaffPath("manager", "/admin/audit")).toBe(false);
    expect(canAccessStaffPath("owner", "/admin/releases")).toBe(true);
    expect(canAccessStaffPath("owner", "/admin/audit")).toBe(true);
    expect(canAccessStaffPath("staff", "/admin/releases")).toBe(false);
  });

  it("identifies staff-facing paths and four-hour idle expiry", () => {
    expect(isStaffFacingPath("/shop")).toBe(false);
    expect(isStaffFacingPath("/admin/products")).toBe(true);
    expect(isStaffSessionExpired(String(Date.now() - STAFF_SESSION_TIMEOUT_MS - 1))).toBe(true);
    expect(isStaffSessionExpired(String(Date.now() - 60_000))).toBe(false);
  });
});
