import { describe, expect, it, vi } from "vitest";

// payment-truth is server-only; the business-date battery below exercises the
// pure branch-local date conversion (plan rule 1.11 — verify:business-date).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  hasSupabaseServiceEnv: () => false,
}));

import { branchLocalDate, formatPence } from "./payment-truth";

const LONDON = "Europe/London";

describe("branchLocalDate — business-date battery (rule 1.11)", () => {
  it("midnight straddle in BST: 23:30 UTC is already TOMORROW in London", () => {
    // 2026-07-13T23:30Z = 2026-07-14 00:30 London (BST, UTC+1)
    expect(branchLocalDate(LONDON, new Date("2026-07-13T23:30:00Z"))).toBe("2026-07-14");
    // …while 22:30 UTC is still the same London day.
    expect(branchLocalDate(LONDON, new Date("2026-07-13T22:30:00Z"))).toBe("2026-07-13");
  });

  it("GMT winter: UTC and London agree at 23:30", () => {
    expect(branchLocalDate(LONDON, new Date("2026-01-10T23:30:00Z"))).toBe("2026-01-10");
  });

  it("BST→GMT transition night (25 Oct 2026): both sides land on the right day", () => {
    // Clocks go back at 02:00 BST → 01:00 GMT on 2026-10-25.
    expect(branchLocalDate(LONDON, new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25"); // still BST: 00:30 local
    expect(branchLocalDate(LONDON, new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-25"); // now GMT: 23:30 local
  });

  it("GMT→BST transition night (29 Mar 2026)", () => {
    // Clocks go forward at 01:00 GMT → 02:00 BST on 2026-03-29.
    expect(branchLocalDate(LONDON, new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-28"); // GMT: 23:30 local
    expect(branchLocalDate(LONDON, new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-30"); // BST: 00:30 local next day
  });

  it("a sale at 23:50 local and a refund at 00:10 next local morning land on different days", () => {
    // BST: 22:50Z = 23:50 local (day 1); 23:10Z = 00:10 local (day 2).
    expect(branchLocalDate(LONDON, new Date("2026-07-13T22:50:00Z"))).toBe("2026-07-13");
    expect(branchLocalDate(LONDON, new Date("2026-07-13T23:10:00Z"))).toBe("2026-07-14");
  });
});

describe("formatPence", () => {
  it("formats signed pence as pounds", () => {
    expect(formatPence(2000)).toBe("£20.00");
    expect(formatPence(-3550)).toBe("-£35.50");
    expect(formatPence(0)).toBe("£0.00");
  });
});
