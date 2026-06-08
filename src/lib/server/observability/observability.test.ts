import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { worstState, isServing } from "@/lib/domain/health";
import { log } from "@/lib/server/observability/log";
import { getMetricsSnapshot, incrementMetric, noteRpcFault, resetMetrics } from "@/lib/server/observability/metrics";

describe("structured log redaction", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function lastEntry() {
    const line = warn.mock.calls.at(-1)?.[0] as string;
    return JSON.parse(line);
  }

  it("emits a JSON entry with the required envelope fields", () => {
    log("AUTH", "warn", "hello", { branchId: "b1", requestId: "r1" });
    const entry = lastEntry();
    expect(entry.category).toBe("AUTH");
    expect(entry.severity).toBe("warn");
    expect(entry.message).toBe("hello");
    expect(typeof entry.timestamp).toBe("string");
    expect(entry.branchId).toBe("b1");
    expect(entry.requestId).toBe("r1");
  });

  it("drops secret-like keys", () => {
    log("SYSTEM", "warn", "x", {
      password: "hunter2",
      token: "abc",
      service_role_key: "k",
      authorization: "Bearer x",
      cookie: "sid=1",
      branchId: "ok",
    });
    const entry = lastEntry();
    expect(entry.password).toBe("[redacted]");
    expect(entry.token).toBe("[redacted]");
    expect(entry.service_role_key).toBe("[redacted]");
    expect(entry.authorization).toBe("[redacted]");
    expect(entry.cookie).toBe("[redacted]");
    expect(entry.branchId).toBe("ok");
  });

  it("redacts JWT-shaped values even under an innocent key", () => {
    // Well-known public local-Supabase demo token (issuer "supabase-demo"): a real
    // JWT shape so the redactor triggers, while the audit-bundle scanner permits it.
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
    log("SYSTEM", "warn", "x", { note: jwt, nested: { deep: jwt } });
    const entry = lastEntry();
    expect(entry.note).toBe("[redacted]");
    expect(entry.nested.deep).toBe("[redacted]");
  });
});

describe("operational metrics", () => {
  beforeEach(() => resetMetrics());

  it("starts at zero and increments", () => {
    expect(getMetricsSnapshot().checkout_success).toBe(0);
    incrementMetric("checkout_success");
    incrementMetric("checkout_success");
    expect(getMetricsSnapshot().checkout_success).toBe(2);
  });

  it("classifies permission errors as rpc_denied and others as database_error", () => {
    expect(noteRpcFault({ message: "permission denied for function" })).toBe("rpc_denied");
    expect(noteRpcFault({ message: "row-level security policy" })).toBe("rpc_denied");
    expect(noteRpcFault({ message: "connection reset" })).toBe("database_error");
    const snap = getMetricsSnapshot();
    expect(snap.rpc_denied).toBe(2);
    expect(snap.database_error).toBe(1);
  });
});

describe("health state folding", () => {
  it("returns the worst state", () => {
    expect(worstState(["HEALTHY", "HEALTHY"])).toBe("HEALTHY");
    expect(worstState(["HEALTHY", "DEGRADED"])).toBe("DEGRADED");
    expect(worstState(["DEGRADED", "CONFIGURATION_REQUIRED"])).toBe("CONFIGURATION_REQUIRED");
    expect(worstState(["CONFIGURATION_REQUIRED", "UNAVAILABLE"])).toBe("UNAVAILABLE");
  });

  it("treats HEALTHY and DEGRADED as serving", () => {
    expect(isServing("HEALTHY")).toBe(true);
    expect(isServing("DEGRADED")).toBe(true);
    expect(isServing("CONFIGURATION_REQUIRED")).toBe(false);
    expect(isServing("UNAVAILABLE")).toBe(false);
  });
});
