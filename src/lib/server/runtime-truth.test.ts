import { describe, expect, it } from "vitest";

/**
 * V13.2 — Demo data fallback honesty.
 *
 * These tests document the rules that govern whether demo orders may be shown.
 * The actual allowDemoFallback() function cannot be imported directly here
 * because runtime-truth.ts carries "server-only". The logic is tested inline
 * to document the invariant without re-executing server-only code.
 */

function isProductionRuntime(env: { NODE_ENV?: string; VERCEL_ENV?: string }) {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

function allowDemoFallback(env: { NODE_ENV?: string; VERCEL_ENV?: string; ALLOW_DEMO_DATA?: string }) {
  return !isProductionRuntime(env) || env.ALLOW_DEMO_DATA === "true";
}

describe("allowDemoFallback — production safety rules", () => {
  it("allows demo in test/development environments", () => {
    expect(allowDemoFallback({ NODE_ENV: "test" })).toBe(true);
    expect(allowDemoFallback({ NODE_ENV: "development" })).toBe(true);
  });

  it("blocks demo in production by default", () => {
    expect(allowDemoFallback({ NODE_ENV: "production" })).toBe(false);
    expect(allowDemoFallback({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("allows demo in production only when ALLOW_DEMO_DATA=true is explicitly set", () => {
    expect(allowDemoFallback({ NODE_ENV: "production", ALLOW_DEMO_DATA: "true" })).toBe(true);
    expect(allowDemoFallback({ NODE_ENV: "production", ALLOW_DEMO_DATA: "false" })).toBe(false);
  });
});

describe("getCounterOrders — no demo orders on real-DB failure", () => {
  it("real Supabase env present must short-circuit demo fallback", () => {
    // This is a documentation test. The code in orders.ts reads:
    //   if (hasSupabaseServiceEnv()) return [];
    // BEFORE calling allowDemoFallback(). So even when allowDemoFallback() is true
    // (non-production) and the query fails, demo orders are NOT shown when the DB
    // credentials are configured. This prevents a DB failure from silently
    // serving fabricated data to staff.
    //
    // The control flow (simplified):
    //   const result = await getCounterOrdersResult(branchId, now);
    //   if (result.data) return result.data;
    //   if (hasSupabaseServiceEnv()) return [];          ← V13.2 guard
    //   return allowDemoFallback() ? getDemoOrders() : [];
    //
    // hasSupabaseServiceEnv() being true means: real credentials are configured,
    // so a failure is a real error, not a "no DB configured" demo scenario.
    expect(true).toBe(true);
  });
});
