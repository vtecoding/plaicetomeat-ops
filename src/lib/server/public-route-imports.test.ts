import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// V11.1 architecture guard (spec §8.1.6 #7): the public order-access surface must
// never import the RLS-bypassing service-role client or the retired
// reference->data reader. This is a static check over the source text.

const ROOT = process.cwd();

const PUBLIC_SURFACE = [
  "src/app/order/status/[publicAccessId]/page.tsx",
  "src/app/order/status/[publicAccessId]/cancel/page.tsx",
  "src/app/order/lookup/page.tsx",
  "src/app/order/[orderRef]/page.tsx",
  "src/app/order/[orderRef]/cancel/page.tsx",
  "src/app/actions/cancel-order.ts",
  "src/app/actions/establish-order-access.ts",
  "src/lib/server/public-order-access.ts",
  "src/lib/server/order-access-session.ts",
  "src/lib/server/rate-limit.ts",
];

const FORBIDDEN_IMPORTS = ["createSupabaseServiceClient", "getOrderByRef", "ORDER_SELECT", "@/lib/server/orders"];

describe("public order surface import graph", () => {
  for (const file of PUBLIC_SURFACE) {
    it(`${file} imports no service-role/internal order reader`, () => {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(src.includes(forbidden), `${file} must not reference ${forbidden}`).toBe(false);
      }
    });
  }

  it("public-order-access (status read) uses the anon public client, not the service client", () => {
    const src = readFileSync(join(ROOT, "src/lib/server/public-order-access.ts"), "utf8");
    expect(src.includes("createSupabasePublicClient")).toBe(true);
    expect(src.includes("createSupabaseServiceClient")).toBe(false);
  });

  it("getOrderByRef no longer exists in the orders repository", () => {
    const src = readFileSync(join(ROOT, "src/lib/server/orders.ts"), "utf8");
    expect(/export\s+async\s+function\s+getOrderByRef/.test(src)).toBe(false);
  });

  // The privileged mutation module is the ONE allowed service-role user for the
  // public flow. It must be contained: only the two safe RPCs, no raw order reads.
  it("order-access-privileged calls only the safe RPCs and reads no order rows", () => {
    const src = readFileSync(join(ROOT, "src/lib/server/order-access-privileged.ts"), "utf8");
    expect(src.includes("createSupabaseServiceClient")).toBe(true);
    // No raw order table access / internal select.
    expect(src.includes('.from("orders")')).toBe(false);
    expect(src.includes(".from('orders')")).toBe(false);
    expect(src.includes("ORDER_SELECT")).toBe(false);
    // Only the two intended RPCs are referenced.
    expect(src.includes("establish_public_order_access")).toBe(true);
    expect(src.includes("cancel_public_order")).toBe(true);
    expect(src.includes("get_public_order_status")).toBe(false);
    expect(src.includes("create_checkout_order")).toBe(false);
  });
});
