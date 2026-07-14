import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { previewOrderAmendment } from "./order-corrections";
import type { OrderItem, Product } from "./types";

const dbIt = process.env.V18_DB_PARITY === "1" ? it : it.skip;

describe("TS display preview ↔ authoritative PostgreSQL fold parity", () => {
  dbIt("matches substitute -> weight adjust -> partial remove exactly", () => {
    const container = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
    const sql = String.raw`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', (
        SELECT id::text FROM public.profiles
        WHERE branch_id='00000000-0000-4000-8000-000000000001' AND role='manager' AND is_active LIMIT 1
      ), true);
      INSERT INTO public.products(id,branch_id,name,slug,unit_type,inventory_policy,price_per_unit,is_available,stock_status)
      VALUES
        ('b4db0000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Parity beef','b4-parity-beef','kg','kg_batch',10,true,'in_stock'),
        ('b4db0000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Parity lamb','b4-parity-lamb','kg','kg_batch',12,true,'in_stock');
      INSERT INTO public.orders(id,branch_id,order_ref,status,pickup_date,subtotal,idempotency_key,is_test)
      VALUES ('b4db0000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','B4-PARITY','prepping',current_date,10,'b4-parity-order',true);
      INSERT INTO public.order_items(id,branch_id,order_id,product_id,product_name_snapshot,quantity,unit_type,unit_price_snapshot,line_total)
      VALUES ('b4db0000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','b4db0000-0000-4000-8000-000000000101','b4db0000-0000-4000-8000-000000000001','Parity beef',1,'kg',10,10);
      SELECT public.amend_order_item_v18('b4db0000-0000-4000-8000-000000000101','b4db0000-0000-4000-8000-000000000201','substitute',NULL,'b4db0000-0000-4000-8000-000000000002',NULL,'b4db0000-0000-4000-8000-000000000301',0,true);
      SELECT public.amend_order_item_v18('b4db0000-0000-4000-8000-000000000101','b4db0000-0000-4000-8000-000000000201','weight_adjust',1.245,NULL,NULL,'b4db0000-0000-4000-8000-000000000302',1,true);
      SELECT public.amend_order_item_v18('b4db0000-0000-4000-8000-000000000101','b4db0000-0000-4000-8000-000000000201','remove',1.1,NULL,NULL,'b4db0000-0000-4000-8000-000000000303',2,false);
      SELECT row_to_json(e)::text FROM public.get_effective_order_lines_v18('b4db0000-0000-4000-8000-000000000101',NULL) e;
      ROLLBACK;
    `;
    const db = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-tA"], {
      input: sql,
      encoding: "utf8",
    });
    expect(db.status, db.stderr).toBe(0);
    const raw = (db.stdout ?? "")
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('{"source_order_item_id"'));
    expect(raw).toBeTruthy();
    const folded = JSON.parse(raw!) as Record<string, unknown>;

    const base: OrderItem = {
      id: "b4db0000-0000-4000-8000-000000000201",
      productId: "b4db0000-0000-4000-8000-000000000001",
      productNameSnapshot: "Parity beef",
      quantity: 1,
      unitType: "kg",
      unitPriceSnapshot: 10,
      lineTotal: 10,
    };
    const lamb = {
      id: "b4db0000-0000-4000-8000-000000000002",
      name: "Parity lamb",
      unitType: "kg",
      pricePerUnit: 12,
    } satisfies Pick<Product, "id" | "name" | "unitType" | "pricePerUnit">;
    const substituted = previewOrderAmendment(base, { kind: "substitute", substituteProductId: lamb.id }, lamb);
    const adjusted = previewOrderAmendment(
      {
        ...base,
        productId: substituted.productId,
        productNameSnapshot: substituted.productName,
        unitPriceSnapshot: substituted.unitPrice,
        lineTotal: substituted.lineTotal,
      },
      { kind: "weight_adjust", newQuantity: 1.245 },
    );
    const removed = previewOrderAmendment(
      {
        ...base,
        productId: adjusted.productId,
        productNameSnapshot: adjusted.productName,
        quantity: adjusted.quantity,
        unitPriceSnapshot: adjusted.unitPrice,
        lineTotal: adjusted.lineTotal,
      },
      { kind: "remove", newQuantity: 1.1 },
    );

    expect({
      productId: folded.product_id,
      productName: folded.product_name,
      quantity: Number(folded.effective_quantity),
      unitPrice: Number(folded.effective_unit_price_pence) / 100,
      lineTotal: Number(folded.line_total_pence) / 100,
      appliedSequence: Number(folded.applied_sequence),
    }).toEqual({
      productId: removed.productId,
      productName: removed.productName,
      quantity: removed.quantity,
      unitPrice: removed.unitPrice,
      lineTotal: removed.lineTotal,
      appliedSequence: 3,
    });
  });
});
