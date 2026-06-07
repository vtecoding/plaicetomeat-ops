import { beforeEach, describe, expect, it, vi } from "vitest";

// login-attempts is server-only and talks to the service client; both are mocked
// so we can prove the account + network lockout combination and hashed storage.
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  accountRows: [] as Array<{ success: boolean; created_at: string }>,
  networkRows: [] as Array<{ success: boolean; created_at: string }>,
  inserted: [] as Array<Record<string, unknown>>,
  hasEnv: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => state.hasEnv,
  createSupabaseServiceClient: () => ({
    from: () => {
      let filter: { col?: string } = {};
      const q = {
        select: () => q,
        eq: (col: string) => {
          filter = { col };
          return q;
        },
        order: () => q,
        limit: () =>
          Promise.resolve({
            data: filter.col === "email" ? state.accountRows : state.networkRows,
            error: null,
          }),
        insert: (row: Record<string, unknown>) => {
          state.inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  }),
}));

import { isLoginLocked, recordLoginAttempt } from "./login-attempts";

const fails = (n: number) =>
  Array.from({ length: n }, () => ({ success: false, created_at: new Date().toISOString() }));

beforeEach(() => {
  state.accountRows = [];
  state.networkRows = [];
  state.inserted = [];
  state.hasEnv = true;
});

describe("login lockout (account + network dimensions)", () => {
  it("locks on the per-account failure budget", async () => {
    state.accountRows = fails(5);
    const result = await isLoginLocked({ email: "a@example.com", networkHash: "net" });
    expect(result.locked).toBe(true);
  });

  it("does not lock the account below its budget", async () => {
    state.accountRows = fails(4);
    const result = await isLoginLocked({ email: "a@example.com", networkHash: "net" });
    expect(result.locked).toBe(false);
  });

  it("uses a looser network budget (a handful of network failures does not lock)", async () => {
    state.accountRows = [];
    state.networkRows = fails(6);
    const result = await isLoginLocked({ email: "a@example.com", networkHash: "net" });
    expect(result.locked).toBe(false);
  });

  it("locks on clearly abusive network volume even with a clean account", async () => {
    state.accountRows = [];
    state.networkRows = fails(20);
    const result = await isLoginLocked({ email: "a@example.com", networkHash: "net" });
    expect(result.locked).toBe(true);
  });

  it("is unlocked when both dimensions are clean", async () => {
    const result = await isLoginLocked({ email: "a@example.com", networkHash: "net" });
    expect(result.locked).toBe(false);
  });

  it("degrades safely (never locks) when the service env is absent", async () => {
    state.hasEnv = false;
    state.accountRows = fails(50);
    const result = await isLoginLocked({ email: "a@example.com", networkHash: "net" });
    expect(result.locked).toBe(false);
  });
});

describe("recordLoginAttempt storage", () => {
  it("stores the hashed network identity, never a raw IP", async () => {
    await recordLoginAttempt({ email: "a@example.com", success: false, networkHash: "hashed-network" });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      email: "a@example.com",
      success: false,
      ip_address: "hashed-network",
    });
  });

  it("writes null when no network signal is available", async () => {
    await recordLoginAttempt({ email: "a@example.com", success: true });
    expect(state.inserted[0]).toMatchObject({ ip_address: null });
  });
});
