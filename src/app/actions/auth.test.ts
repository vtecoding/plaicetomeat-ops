import { beforeEach, describe, expect, it, vi } from "vitest";

// Adversarial/behavioural coverage for logout hardening (V12.2): a failed
// signOut() must be SURFACED, never swallowed. We mock the server boundary so
// the action can run in isolation.
vi.mock("server-only", () => ({}));

const { cookieStore, signOutMock, redirectMock } = vi.hoisted(() => ({
  cookieStore: { set: vi.fn(), delete: vi.fn() },
  signOutMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  hasSupabasePublicEnv: () => true,
  hasSupabaseServiceEnv: () => false,
  createSupabaseServerClient: async () => ({ auth: { signOut: signOutMock } }),
  createSupabaseServiceClient: () => ({}),
}));

import { logoutAction } from "@/app/actions/auth";

beforeEach(() => {
  cookieStore.set.mockClear();
  cookieStore.delete.mockClear();
  signOutMock.mockReset();
  redirectMock.mockClear();
});

const emptyForm = new FormData();

describe("logoutAction", () => {
  it("surfaces a failed sign-out instead of swallowing it", async () => {
    signOutMock.mockResolvedValue({ error: { code: "boom", status: 500 } });

    const result = await logoutAction({ error: null }, emptyForm);

    expect(result.error).toMatch(/couldn't fully sign you out/i);
    // Must NOT pretend success: no redirect, session cookie left intact.
    expect(redirectMock).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("clears the session cookie and redirects on a clean sign-out", async () => {
    signOutMock.mockResolvedValue({ error: null });

    await expect(logoutAction({ error: null }, emptyForm)).rejects.toThrow("redirect:/login");
    expect(cookieStore.delete).toHaveBeenCalledWith("ptm_staff_last_seen");
  });
});
