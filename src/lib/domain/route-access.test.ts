import { describe, expect, it } from "vitest";

import { canAccessStaffPath, hasMinRole, isBranchAuthorised, isStaffFacingPath } from "./route-access";

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

  it("identifies staff-facing paths", () => {
    expect(isStaffFacingPath("/shop")).toBe(false);
    expect(isStaffFacingPath("/admin/products")).toBe(true);
    expect(isStaffFacingPath("/counter")).toBe(true);
    // /compliance is not a real route — it must not be treated as staff-facing.
    expect(isStaffFacingPath("/compliance")).toBe(false);
  });

  it("ranks roles so authority is explicit and missing roles fail closed", () => {
    expect(hasMinRole(null, "staff")).toBe(false);
    expect(hasMinRole(undefined, "staff")).toBe(false);
    expect(hasMinRole("staff", "staff")).toBe(true);
    expect(hasMinRole("staff", "manager")).toBe(false);
    expect(hasMinRole("manager", "manager")).toBe(true);
    expect(hasMinRole("manager", "owner")).toBe(false);
    // Owner is branch-global: outranks everything, so access is never accidental.
    expect(hasMinRole("owner", "owner")).toBe(true);
    expect(hasMinRole("owner", "manager")).toBe(true);
    expect(hasMinRole("owner", "staff")).toBe(true);
  });

  it("isolates branches so A cannot reach B and null branches fail closed", () => {
    // Branch A staff/manager can act on branch A, never branch B.
    expect(isBranchAuthorised("staff", "branch-A", "branch-A")).toBe(true);
    expect(isBranchAuthorised("staff", "branch-A", "branch-B")).toBe(false);
    expect(isBranchAuthorised("manager", "branch-A", "branch-B")).toBe(false);
    // Null branch profiles fail closed everywhere.
    expect(isBranchAuthorised("staff", null, "branch-A")).toBe(false);
    expect(isBranchAuthorised("manager", null, "branch-A")).toBe(false);
    // Owner is branch-global.
    expect(isBranchAuthorised("owner", null, "branch-A")).toBe(true);
    expect(isBranchAuthorised("owner", "branch-A", "branch-B")).toBe(true);
  });
});
