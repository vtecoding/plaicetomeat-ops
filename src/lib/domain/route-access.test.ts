import { describe, expect, it } from "vitest";

import {
  canAccessStaffPath,
  hasMinRole,
  isBranchAuthorised,
  isOperatorAccount,
  isStaffFacingPath,
} from "./route-access";

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
    expect(canAccessStaffPath("manager", "/admin/away")).toBe(false);
    expect(canAccessStaffPath("owner", "/admin/releases")).toBe(true);
    expect(canAccessStaffPath("owner", "/admin/audit")).toBe(true);
    expect(canAccessStaffPath("owner", "/admin/away")).toBe(true);
    expect(canAccessStaffPath("staff", "/admin/releases")).toBe(false);
  });

  it("identifies staff-facing paths", () => {
    expect(isStaffFacingPath("/shop")).toBe(false);
    expect(isStaffFacingPath("/admin/products")).toBe(true);
    expect(isStaffFacingPath("/counter")).toBe(true);
    expect(isStaffFacingPath("/operator")).toBe(true);
    expect(isStaffFacingPath("/operator/open")).toBe(true);
    // /compliance is not a real route — it must not be treated as staff-facing.
    expect(isStaffFacingPath("/compliance")).toBe(false);
  });

  describe("V17 operator mode", () => {
    it("treats only a manager/owner-rank account with the flag as operator-locked", () => {
      expect(isOperatorAccount("manager", true)).toBe(true);
      // The flag without manager rank is meaningless (staff can never be operator).
      expect(isOperatorAccount("staff", true)).toBe(false);
      // The owner is never operator-locked even if a flag were set.
      expect(isOperatorAccount("owner", true)).toBe(false);
      expect(isOperatorAccount("manager", false)).toBe(false);
      expect(isOperatorAccount(null, true)).toBe(false);
    });

    it("locks an operator account to /operator and bars /admin and /counter", () => {
      const operator = { operatorMode: true };
      expect(canAccessStaffPath("manager", "/operator", operator)).toBe(true);
      expect(canAccessStaffPath("manager", "/operator/open", operator)).toBe(true);
      expect(canAccessStaffPath("manager", "/admin", operator)).toBe(false);
      expect(canAccessStaffPath("manager", "/admin/today", operator)).toBe(false);
      expect(canAccessStaffPath("manager", "/counter", operator)).toBe(false);
    });

    it("lets a normal manager/owner preview operator mode but keeps counter staff out", () => {
      expect(canAccessStaffPath("manager", "/operator")).toBe(true);
      expect(canAccessStaffPath("owner", "/operator")).toBe(true);
      expect(canAccessStaffPath("staff", "/operator")).toBe(false);
    });

    it("does not change normal access when the operator flag is absent", () => {
      expect(canAccessStaffPath("manager", "/admin/settings")).toBe(true);
      expect(canAccessStaffPath("staff", "/counter")).toBe(true);
      expect(canAccessStaffPath("owner", "/admin")).toBe(true);
    });
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
