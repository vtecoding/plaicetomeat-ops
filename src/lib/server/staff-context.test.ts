import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StaffProfile } from "@/lib/server/auth";

// staff-context imports `server-only` (throws outside RSC) plus next/navigation
// and getCurrentProfile — all mocked so the authority logic can be exercised.
vi.mock("server-only", () => ({}));

const { getCurrentProfileMock } = vi.hoisted(() => ({ getCurrentProfileMock: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ getCurrentProfile: getCurrentProfileMock }));

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { requireStaffContext, resolveStaffContext } from "@/lib/server/staff-context";

function profile(overrides: Partial<StaffProfile>): StaffProfile {
  return {
    id: "user-1",
    email: "staff@example.com",
    fullName: "Staff Member",
    role: "manager",
    branchId: "branch-A",
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  getCurrentProfileMock.mockReset();
  redirectMock.mockClear();
});

describe("resolveStaffContext", () => {
  it("refuses an unauthenticated caller", async () => {
    getCurrentProfileMock.mockResolvedValue(null);
    const result = await resolveStaffContext("staff");
    expect(result).toMatchObject({ ok: false, reason: "unauthenticated" });
  });

  it("refuses a caller below the required role (manager cannot reach owner)", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "manager" }));
    const result = await resolveStaffContext("owner");
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("refuses a null-branch profile on a branch-scoped surface (fails closed)", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "manager", branchId: null }));
    const result = await resolveStaffContext("manager", { branchScoped: true });
    expect(result).toMatchObject({ ok: false, reason: "no_branch" });
  });

  it("refuses even an OWNER with no branch on a branch-scoped surface", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "owner", branchId: null }));
    const result = await resolveStaffContext("owner", { branchScoped: true });
    expect(result).toMatchObject({ ok: false, reason: "no_branch" });
  });

  it("resolves a branch-scoped context with a concrete branch id", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "manager", branchId: "branch-A" }));
    const result = await resolveStaffContext("manager", { branchScoped: true });
    expect(result).toEqual({ ok: true, profile: expect.objectContaining({ id: "user-1" }), branchId: "branch-A" });
  });

  it("treats owner as branch-global for non-branch-scoped access", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "owner", branchId: null }));
    const result = await resolveStaffContext("manager");
    expect(result).toMatchObject({ ok: true });
  });
});

describe("requireStaffContext redirects", () => {
  it("sends an unauthenticated caller to /login", async () => {
    getCurrentProfileMock.mockResolvedValue(null);
    await expect(requireStaffContext("manager")).rejects.toThrow("redirect:/login");
  });

  it("sends a forbidden caller to /unauthorised", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "manager" }));
    await expect(requireStaffContext("owner")).rejects.toThrow("redirect:/unauthorised");
  });

  it("sends a null-branch caller on a branch-scoped page to /unauthorised", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "manager", branchId: null }));
    await expect(requireStaffContext("manager", { branchScoped: true })).rejects.toThrow("redirect:/unauthorised");
  });

  it("returns the context when authorised", async () => {
    getCurrentProfileMock.mockResolvedValue(profile({ role: "owner", branchId: "branch-A" }));
    const ctx = await requireStaffContext("manager", { branchScoped: true });
    expect(ctx.branchId).toBe("branch-A");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
