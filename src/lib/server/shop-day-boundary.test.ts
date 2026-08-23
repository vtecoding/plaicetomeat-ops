import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/lib/server/shop-day.ts"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202608231300_shop_day_trading_guards.sql"),
  "utf8",
);
const serveIdentityFix = readFileSync(
  join(process.cwd(), "supabase/migrations/202608231400_shop_day_serve_guard_identity.sql"),
  "utf8",
);

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

  it("gates every Operator trading writer on the server and in the database", () => {
    for (const file of ["serve.ts", "delivery.ts", "waste.ts", "till.ts"]) {
      const action = readFileSync(join(process.cwd(), "src/app/actions/operator", file), "utf8");
      expect(action, file).toContain("requireShopDayAction");
    }

    for (const writer of [
      "create_operator_serve_order_v18",
      "complete_operator_no_waste_v18",
      "record_operator_waste_v18",
      "record_operator_delivery_v18",
      "record_till_event",
    ]) {
      expect(migration, writer).toContain(`CREATE FUNCTION public.${writer}`);
    }
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("IF p_kind = 'closing'");
    expect(migration).toContain("status = 'completed'");
  });

  it("keeps the old atomic writers private behind the guarded names", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.create_operator_serve_order_unguarded_v18[\s\S]*service_role/);
    expect(migration).toContain("RETURN public.create_operator_serve_order_unguarded_v18");
  });

  it("guards an atomic sale even when its background draft does not exist yet", () => {
    expect(serveIdentityFix).toContain("v_actor uuid := auth.uid()");
    expect(serveIdentityFix).toContain("WHERE id = v_actor");
    expect(serveIdentityFix).toContain("AND is_active = true");
    expect(serveIdentityFix).toContain("PERFORM public.assert_shop_day_trading_v19(v_branch_id)");
    expect(serveIdentityFix).toContain("RETURN public.create_operator_serve_order_unguarded_v18");
  });
});
