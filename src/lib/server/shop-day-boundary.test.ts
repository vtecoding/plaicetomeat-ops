import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/lib/server/shop-day.ts"), "utf8");

describe("Shop Day server boundary", () => {
  it("derives the day from persisted rituals on the authoritative branch-local date", () => {
    expect(source).toContain("await getBranchBusinessDate(branchId, now)");
    expect(source).toContain('.from("ops_checklist_sessions")');
    expect(source).toContain('.eq("business_date", businessDate)');
    expect(source).not.toContain("toISOString().slice(0, 10)");
  });

  it("does not introduce a second shop-day table or mutable navigation state", () => {
    expect(source).not.toContain('.from("shop_days")');
    expect(source).not.toContain("searchParams");
    expect(source).not.toContain("cookies(");
  });
});
