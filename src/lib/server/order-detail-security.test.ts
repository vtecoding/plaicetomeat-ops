import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("internal order detail branch boundary", () => {
  it("requires an authenticated branch-scoped staff context on the detail route", () => {
    const source = readFileSync(join(ROOT, "src/app/counter/orders/[id]/page.tsx"), "utf8");
    expect(source).toContain('requireStaffContext("staff", { branchScoped: true })');
  });

  it("hydrates a single order with the caller JWT instead of service-role bypass", () => {
    const source = readFileSync(join(ROOT, "src/lib/server/orders.ts"), "utf8");
    const start = source.indexOf("export async function getOrderById");
    const end = source.indexOf("// NOTE: getOrderByRef", start);
    const reader = source.slice(start, end);
    expect(reader).toContain("await createSupabaseServerClient()");
    expect(reader).not.toContain("createSupabaseServiceClient()");
  });
});
