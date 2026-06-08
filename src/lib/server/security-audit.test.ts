import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => {
  const rpcMock = vi.fn();
  return { rpcMock, createClientMock: vi.fn(() => ({ rpc: rpcMock })) };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import { SECURITY_REASON } from "@/lib/domain/security-events";
import { recordSecurityEvent } from "@/lib/server/security-audit";

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: "audit-id", error: null });
  createClientMock.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recordSecurityEvent", () => {
  it("emits via the hardened emit_audit_log as a service-authoritative system event", async () => {
    await recordSecurityEvent({
      reason: SECURITY_REASON.LOGIN_FAILED,
      targetType: "auth",
      metadata: { emailHash: "h-email", networkHash: "h-net" },
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe("emit_audit_log");
    expect(args.p_event_type).toBe("security_event");
    expect(args.p_system_reason).toBe("login_failed"); // system emission requires a reason
    expect(args.p_target_type).toBe("auth");
    expect(args.p_metadata).toEqual({ emailHash: "h-email", networkHash: "h-net" });
  });

  it("degrades safely (no call) when the service env is absent", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await recordSecurityEvent({ reason: SECURITY_REASON.LOGOUT_FAILED });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("never throws even if emission fails", async () => {
    rpcMock.mockRejectedValue(new Error("db down"));
    await expect(recordSecurityEvent({ reason: SECURITY_REASON.SESSION_INVALID })).resolves.toBeUndefined();
  });
});
