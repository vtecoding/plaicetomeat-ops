import { beforeEach, describe, expect, it, vi } from "vitest";

// V12.2 logout hardening + V12.4 security-event coverage for the auth surface.
// The server boundary is mocked so the actions run in isolation.
vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  cookieStore: { set: vi.fn(), delete: vi.fn() },
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
  profileResult: { data: null as unknown },
  isLoginLockedMock: vi.fn(),
  recordLoginAttemptMock: vi.fn(async () => {}),
  recordSecurityEventMock: vi.fn(async (_input: import("@/lib/server/security-audit").SecurityEventInput) => {}),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => h.cookieStore,
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({ redirect: h.redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  hasSupabasePublicEnv: () => true,
  hasSupabaseServiceEnv: () => false,
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword: h.signInMock, signOut: h.signOutMock } }),
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => h.profileResult }) }),
    }),
  }),
}));
vi.mock("@/lib/server/login-attempts", () => ({
  isLoginLocked: h.isLoginLockedMock,
  recordLoginAttempt: h.recordLoginAttemptMock,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  clientNetworkHash: async () => "hashed-net",
  // Return only the label, never the raw value — guarantees no PII echo.
  hashIdentity: (label: string) => `hashed-${label}`,
}));
vi.mock("@/lib/server/staff-session", () => ({
  signEnvelope: async () => "signed-token",
  STAFF_SESSION_COOKIE: "ptm_staff_last_seen",
}));
vi.mock("@/lib/server/security-audit", () => ({ recordSecurityEvent: h.recordSecurityEventMock }));

import { loginAction, logoutAction } from "@/app/actions/auth";
import { SECURITY_REASON } from "@/lib/domain/security-events";

const EMAIL = "person@example.com";

function loginForm(): FormData {
  const fd = new FormData();
  fd.set("email", EMAIL);
  fd.set("password", "hunter2hunter2");
  return fd;
}

function reasons() {
  return h.recordSecurityEventMock.mock.calls.map((c) => c[0].reason);
}

beforeEach(() => {
  h.cookieStore.set.mockClear();
  h.cookieStore.delete.mockClear();
  h.signInMock.mockReset();
  h.signOutMock.mockReset();
  h.isLoginLockedMock.mockReset();
  h.recordLoginAttemptMock.mockClear();
  h.recordSecurityEventMock.mockClear();
  h.redirectMock.mockClear();
  h.profileResult = { data: null };
  h.isLoginLockedMock.mockResolvedValue({ locked: false, lockedUntil: null });
});

describe("loginAction security events", () => {
  it("emits login_locked_out when the account/network is locked", async () => {
    h.isLoginLockedMock.mockResolvedValue({ locked: true, lockedUntil: new Date() });

    const result = await loginAction({ error: null }, loginForm());

    expect(result.error).toMatch(/too many/i);
    expect(reasons()).toContain(SECURITY_REASON.LOGIN_LOCKED_OUT);
    expect(h.signInMock).not.toHaveBeenCalled();
  });

  it("emits login_failed on bad credentials", async () => {
    h.signInMock.mockResolvedValue({ data: { user: null }, error: { code: "invalid", status: 400 } });

    const result = await loginAction({ error: null }, loginForm());

    expect(result.error).toBe("Invalid email or password.");
    expect(reasons()).toContain(SECURITY_REASON.LOGIN_FAILED);
  });

  it("emits login_failed when the account is authenticated but not active staff", async () => {
    h.signInMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    h.profileResult = { data: { role: null, is_active: false } };

    const result = await loginAction({ error: null }, loginForm());

    expect(result.error).toBe("Invalid email or password.");
    expect(reasons()).toContain(SECURITY_REASON.LOGIN_FAILED);
  });

  it("does NOT emit a security event on a successful login", async () => {
    h.signInMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    h.profileResult = { data: { role: "manager", is_active: true } };

    await expect(loginAction({ error: null }, loginForm())).rejects.toThrow(/^redirect:/);
    expect(h.recordSecurityEventMock).not.toHaveBeenCalled();
    expect(h.cookieStore.set).toHaveBeenCalled();
  });

  it("never includes the raw email in security metadata (hashed only)", async () => {
    h.signInMock.mockResolvedValue({ data: { user: null }, error: { code: "invalid" } });

    await loginAction({ error: null }, loginForm());

    const serialised = JSON.stringify(h.recordSecurityEventMock.mock.calls.map((c) => c[0]));
    expect(serialised).not.toContain(EMAIL);
    expect(serialised).toContain("hashed-email");
    expect(serialised).toContain("hashed-net");
  });
});

describe("logoutAction", () => {
  it("emits logout_failed and surfaces the error when sign-out fails", async () => {
    h.signOutMock.mockResolvedValue({ error: { code: "boom", status: 500 } });

    const result = await logoutAction({ error: null }, new FormData());

    expect(result.error).toMatch(/couldn't fully sign you out/i);
    expect(reasons()).toContain(SECURITY_REASON.LOGOUT_FAILED);
    expect(h.redirectMock).not.toHaveBeenCalled();
    expect(h.cookieStore.delete).not.toHaveBeenCalled();
  });

  it("clears the cookie and redirects on a clean sign-out (no security event)", async () => {
    h.signOutMock.mockResolvedValue({ error: null });

    await expect(logoutAction({ error: null }, new FormData())).rejects.toThrow("redirect:/login");
    expect(h.cookieStore.delete).toHaveBeenCalledWith("ptm_staff_last_seen");
    expect(h.recordSecurityEventMock).not.toHaveBeenCalled();
  });
});
