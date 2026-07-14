import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("canonical V18 business-state consumers", () => {
  it("projects branch history through the one authoritative amendment fold", () => {
    const migration = source("supabase/migrations/202607141700_v18_order_amendments.sql");
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.get_branch_effective_order_lines_v18");
    const end = migration.indexOf("CREATE OR REPLACE FUNCTION public.amend_order_item_v18", start);
    const projection = migration.slice(start, end);

    expect(projection).toContain("public.get_effective_order_lines_v18(o.id, NULL)");
    expect(projection).toContain("FROM public.refund_line_outcomes rlo");
    expect(projection).toContain("refunded_amount_pence");
    expect(projection).toContain("stock_returned_kg");
    expect(projection).toContain("GRANT EXECUTE ON FUNCTION public.get_branch_effective_order_lines_v18");
    expect(projection).toContain("TO service_role");
    expect(projection).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("uses folded lines and payment facts for owner operations intelligence", () => {
    const operations = source("src/lib/server/operations-intelligence.ts");

    expect(operations).toContain('supabase.rpc("get_branch_effective_order_lines_v18"');
    expect(operations).toContain('.from("payment_events")');
    expect(operations).toContain('.gte("business_date", sinceBusinessDate)');
    expect(operations).toContain("await getBranchBusinessDate(branchId, now)");
    expect(operations).toContain("addBusinessCalendarDays(today, -1)");
    expect(operations).toContain("row.line_total_pence - row.refunded_amount_pence");
    expect(operations).toContain("effectiveQuantity - toNum(row.refunded_quantity)");
    expect(operations).not.toContain('.from("order_items")');
    expect(operations).not.toContain('.select("id, customer_name, customer_phone, subtotal');
  });

  it("derives dashboard and weekly revenue from the net payment ledger", () => {
    const dashboard = source("src/lib/server/dashboard.ts");
    const shop = source("src/lib/server/shop-intelligence.ts");

    expect(dashboard).toContain('.from("payment_events")');
    expect(dashboard).toContain('.eq("business_date", date)');
    expect(dashboard).toContain("await getBranchBusinessDate(branchId, now)");
    expect(dashboard).not.toContain('.select("status, subtotal');
    expect(shop).toContain('.from("payment_events")');
    expect(shop).toContain('.gte("business_date", weekStart)');
    expect(shop).toContain("addBusinessCalendarDays(businessDate, -6)");
    expect(shop).toContain("await getBranchBusinessDate(branchId, now)");
    expect(shop).not.toContain('.select("subtotal, status, is_test, created_at")');
  });

  it("keeps the service-role waste count inside the requested branch", () => {
    const dashboard = source("src/lib/server/dashboard.ts");
    const start = dashboard.indexOf('.from("inventory_waste_events")');
    const end = dashboard.indexOf("return {", start);
    const wasteQuery = dashboard.slice(start, end);

    // Service-role reads bypass RLS, so the joined product branch predicate is
    // what prevents branch B waste from inflating branch A's dashboard.
    expect(wasteQuery).toContain('.eq("product.branch_id", branchId)');
    expect(wasteQuery).toContain('.eq("product.inventory_policy", "kg_batch")');
  });
});
