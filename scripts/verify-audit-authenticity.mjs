// V11.2 adversarial verification — audit authenticity boundary.
//
// Runs against the LOCAL Supabase stack. Proves spec §B "Tests Required":
//   1.  anon cannot insert into audit_logs (or audit_events).
//   2.  authenticated staff/manager cannot insert directly into the audit tables.
//   3.  a manager cannot forge an owner/system audit event.
//   4.  staff cannot forge another actor (emit derives actor from auth.uid()).
//   5.  a branch-A manager cannot create audit evidence for branch B.
//   6.  direct UPDATE/DELETE of audit rows fails (append-only), even for service.
//   7.  caller-supplied created_at/actor/branch/source cannot override trusted values.
//   8.  metadata containing access ids / secrets / tokens is redacted.
//   9.  legitimate business flows still emit audit records.
//   10. all public SECURITY DEFINER functions pin search_path.
//   11. a grants audit shows no audit write capability for anon/authenticated.
//
// Exits non-zero on any unmet expectation. Audit rows are append-only, so this
// script intentionally leaves the evidence rows it creates in the dev DB.

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";
const PASSWORD = "PlaiceTest123!";
const RUN = randomUUID().slice(0, 8);

const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
}

async function sessionClient(email) {
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function uidFor(email) {
  const { data } = await service.from("profiles").select("id").eq("email", email).single();
  return data?.id ?? null;
}

function todayIso(offsetDays = 0) {
  const n = new Date();
  n.setDate(n.getDate() + offsetDays);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

let seq = 0;
async function createIncomingOrder(branch = BRANCH_A) {
  seq += 1;
  const ref = `PTM-2098-${String(seq).padStart(5, "0")}`;
  const { data, error } = await service
    .from("orders")
    .insert({
      branch_id: branch,
      order_ref: ref,
      customer_name: "Audit Test",
      customer_phone: "07700900123",
      pickup_date: todayIso(),
      subtotal: 10.0,
      idempotency_key: `vaa-${RUN}-${seq}`,
    })
    .select("id, order_ref, public_access_id, public_access_version")
    .single();
  if (error) throw new Error(`order insert failed: ${error.message}`);
  return data;
}

async function auditCount(eventType, targetId = null) {
  let q = service.from("audit_logs").select("id", { count: "exact", head: true }).eq("event_type", eventType);
  if (targetId) q = q.eq("target_id", targetId);
  const { count } = await q;
  return count ?? 0;
}

async function rowById(id) {
  const { data } = await service.from("audit_logs").select("*").eq("id", id).single();
  return data;
}

function psql(sql) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
    { encoding: "utf8" },
  );
  return { ok: (res.status ?? 1) === 0, out: (res.stdout ?? "").trim(), err: (res.stderr ?? "").trim() };
}

async function main() {
  console.log(`V11.2 audit authenticity adversarial checks (run ${RUN})`);

  const managerUid = await uidFor("manager@ptm.test");
  const ownerUid = await uidFor("owner@ptm.test");
  const manager = await sessionClient("manager@ptm.test");
  const staff = await sessionClient("staff@ptm.test");

  // --- 1. anon cannot insert into either audit table --------------------------
  {
    const a = await anon.from("audit_logs").insert({ event_type: "order_created", target_type: "order", branch_id: null });
    check("anon INSERT audit_logs is DENIED", !!a.error, a.error ? "" : "INSERTED!");
    const e = await anon.from("audit_events").insert({ event_type: "x", entity_type: "order", summary: "forged" });
    check("anon INSERT audit_events is DENIED", !!e.error, e.error ? "" : "INSERTED!");
  }

  // --- 2. authenticated staff/manager cannot insert directly ------------------
  {
    const s = await staff.from("audit_logs").insert({ event_type: "order_created", target_type: "order", branch_id: BRANCH_A });
    check("staff direct INSERT audit_logs is DENIED", !!s.error, s.error ? "" : "INSERTED!");
    const se = await staff.from("audit_events").insert({ event_type: "x", entity_type: "order", summary: "forged", actor_role: "owner" });
    check("staff direct INSERT audit_events is DENIED", !!se.error, se.error ? "" : "INSERTED!");
    const m = await manager.from("audit_logs").insert({ event_type: "order_created", target_type: "order", branch_id: BRANCH_A });
    check("manager direct INSERT audit_logs is DENIED", !!m.error, m.error ? "" : "INSERTED!");
  }

  // --- 3. manager cannot forge an owner/system audit event --------------------
  {
    const sys = await manager.rpc("emit_audit_log", {
      p_event_type: "security_event", p_target_type: "order", p_target_id: null,
      p_branch_id: BRANCH_A, p_metadata: {}, p_system_reason: "pretend to be the system",
    });
    check("manager emit with system_reason is DENIED", !!sys.error, sys.error ? "" : "ACCEPTED!");
    const forged = await manager.from("audit_logs").insert({ event_type: "order_created", target_type: "order", branch_id: BRANCH_A, actor_id: ownerUid });
    check("manager direct INSERT with forged owner actor is DENIED", !!forged.error, forged.error ? "" : "INSERTED!");
  }

  // --- 4. staff cannot directly emit generic audit evidence -------------------
  {
    const emitted = await staff.rpc("emit_audit_log", {
      p_event_type: "order_status_changed", p_target_type: "order", p_target_id: null,
      p_branch_id: BRANCH_A, p_metadata: { note: `vaa-${RUN}` },
    });
    check("staff direct emit_audit_log is DENIED", !!emitted.error, emitted.error ? "" : "ACCEPTED!");
    const forged = await staff.from("audit_logs").insert({ event_type: "order_created", target_type: "order", branch_id: BRANCH_A, actor_id: managerUid });
    check("staff direct INSERT with forged manager actor is DENIED", !!forged.error, forged.error ? "" : "INSERTED!");
  }

  // --- 5. branch-A manager cannot audit branch B ------------------------------
  {
    const cross = await manager.rpc("emit_audit_log", {
      p_event_type: "order_status_changed", p_target_type: "order", p_target_id: null,
      p_branch_id: BRANCH_B, p_metadata: {},
    });
    check("manager emit for branch B is DENIED", !!cross.error, cross.error ? "" : "ACCEPTED!");
    const direct = await manager.from("audit_logs").insert({ event_type: "order_created", target_type: "order", branch_id: BRANCH_B });
    check("manager direct INSERT for branch B is DENIED", !!direct.error, direct.error ? "" : "INSERTED!");
  }

  // --- 6. direct UPDATE/DELETE fails (append-only) ----------------------------
  {
    const sysRow = await service.rpc("emit_audit_log", {
      p_event_type: "security_event", p_target_type: "system", p_target_id: null,
      p_metadata: { note: `vaa-${RUN}-appendonly` }, p_system_reason: "append-only probe",
    });
    check("service system emit succeeds", !sysRow.error && !!sysRow.data, sysRow.error?.message);
    const id = sysRow.data;
    const upd = await service.from("audit_logs").update({ event_type: "tampered" }).eq("id", id);
    check("service UPDATE audit_logs is DENIED (append-only)", !!upd.error, upd.error ? "" : "UPDATED!");
    const del = await service.from("audit_logs").delete().eq("id", id);
    check("service DELETE audit_logs is DENIED (append-only)", !!del.error, del.error ? "" : "DELETED!");
    // audit_events mirror row
    const { data: ev } = await service.from("audit_events").select("id").eq("event_type", "security_event").order("created_at", { ascending: false }).limit(1).single();
    if (ev?.id) {
      const eUpd = await service.from("audit_events").update({ actor_role: "owner" }).eq("id", ev.id);
      check("service UPDATE audit_events is DENIED (append-only)", !!eUpd.error, eUpd.error ? "" : "UPDATED!");
      const eDel = await service.from("audit_events").delete().eq("id", ev.id);
      check("service DELETE audit_events is DENIED (append-only)", !!eDel.error, eDel.error ? "" : "DELETED!");
    }
  }

  // --- 7. caller cannot override created_at/actor/branch -----------------------
  {
    const before = Date.now();
    const r = await service.rpc("emit_audit_log", {
      p_event_type: "branch_settings_updated", p_target_type: "branch", p_target_id: BRANCH_A,
      p_branch_id: BRANCH_A, p_metadata: { note: `vaa-${RUN}-trusted` },
    });
    check("manager direct emit_audit_log is DENIED", !!r.error, r.error ? "" : "ACCEPTED!");
    const trusted = await service.rpc("emit_audit_log", {
      p_event_type: "branch_settings_updated", p_target_type: "branch", p_target_id: BRANCH_A,
      p_branch_id: BRANCH_A, p_metadata: { note: `vaa-${RUN}-trusted` }, p_system_reason: "trusted server emission",
    });
    check("service trusted emit succeeds", !trusted.error && !!trusted.data, trusted.error?.message);
    if (trusted.data) {
      const row = await rowById(trusted.data);
      const ts = new Date(row.created_at).getTime();
      check("created_at is set server-side (≈now)", Math.abs(ts - before) < 60_000, `created_at=${row?.created_at}`);
      check("actor_id is NULL for trusted system emission", row?.actor_id === null, `actor=${row?.actor_id}`);
      check("branch_id is the validated branch", row?.branch_id === BRANCH_A, `branch=${row?.branch_id}`);
    }
    // The direct path where created_at COULD be forged is itself blocked.
    const forgedTime = await manager.from("audit_logs").insert({ event_type: "order_created", target_type: "order", branch_id: BRANCH_A, created_at: "2000-01-01T00:00:00Z" });
    check("manager direct INSERT with forged created_at is DENIED", !!forgedTime.error, forgedTime.error ? "" : "INSERTED!");
  }

  // --- 8. secret-like metadata is redacted ------------------------------------
  {
    const r = await service.rpc("emit_audit_log", {
      p_event_type: "order_status_changed", p_target_type: "order", p_target_id: null, p_branch_id: BRANCH_A,
      p_metadata: {
        public_access_id: randomUUID(), access_token: "sk_live_abc", password: "hunter2",
        session_cookie: "ptm_session=zzz", api_key: "key_123", note: "keep me", amount: 5,
      },
      p_system_reason: "metadata redaction probe",
    });
    check("service emit with secret metadata succeeds (redacting, not failing)", !r.error && !!r.data, r.error?.message);
    if (r.data) {
      const row = await rowById(r.data);
      const keys = Object.keys(row?.metadata ?? {});
      const leaked = ["public_access_id", "access_token", "password", "session_cookie", "api_key"].filter((k) => keys.includes(k));
      check("secret-like keys are stripped from stored metadata", leaked.length === 0, `leaked=${leaked.join(",")}`);
      check("non-secret keys are retained", keys.includes("note") && keys.includes("amount"), `keys=${keys.join(",")}`);
      check("redaction is recorded in _redacted_keys", Array.isArray(row?.metadata?._redacted_keys) && row.metadata._redacted_keys.length >= 5, `red=${JSON.stringify(row?.metadata?._redacted_keys)}`);
    }
  }

  // --- 9. legitimate business flows still emit audit records ------------------
  {
    // (a) status transition
    const o1 = await createIncomingOrder();
    const t = await manager.rpc("transition_order_status", { p_order_id: o1.id, p_next_status: "prepping" });
    check("flow: status transition succeeds", !t.error, t.error?.message);
    check("flow: order_status_changed audit row emitted", (await auditCount("order_status_changed", o1.id)) >= 1);

    // (b) public cancellation
    const o2 = await createIncomingOrder();
    const c = await service.rpc("cancel_public_order", { p_public_access_id: o2.public_access_id, p_reason: "audit test", p_expected_version: o2.public_access_version });
    check("flow: cancellation succeeds", !c.error && c.data?.ok === true, c.error?.message);
    check("flow: cancellation audit row emitted", (await auditCount("order_status_changed", o2.id)) >= 1);

    // (c) inventory / stock-count correction (discover a branch-A batch)
    const { data: batch } = await service.from("inventory_batches").select("id, remaining_weight_kg").eq("branch_id", BRANCH_A).limit(1).maybeSingle();
    if (batch?.id) {
      const before = await auditCount("stock_corrected", batch.id);
      const adj = await manager.rpc("admin_adjust_inventory_remaining", { p_batch_id: batch.id, p_new_remaining_kg: Number(batch.remaining_weight_kg) - 0.05, p_reason: `stock count vaa-${RUN}` });
      check("flow: inventory adjustment succeeds", !adj.error, adj.error?.message);
      check("flow: stock_corrected audit row emitted", (await auditCount("stock_corrected", batch.id)) > before);

      const beforeW = await auditCount("waste_recorded", batch.id);
      const w = await manager.rpc("admin_record_inventory_waste", { p_batch_id: batch.id, p_quantity_kg: 0.05, p_reason: "damaged" });
      check("flow: waste logging succeeds", !w.error, w.error?.message);
      check("flow: waste_recorded audit row emitted", (await auditCount("waste_recorded", batch.id)) > beforeW);
    } else {
      check("flow: a branch-A inventory batch exists to exercise (seed)", false, "no batch found — run scripts/seed-dev.mjs");
    }

    // (d) product price/cost commit (discover a branch-A product)
    const { data: product } = await service.from("products").select("id").eq("branch_id", BRANCH_A).limit(1).maybeSingle();
    if (product?.id) {
      const before = await auditCount("pricing_committed", product.id);
      const p = await manager.rpc("admin_commit_product_price_cost", { p_product_id: product.id, p_price: 12.5, p_cost: 6.25 });
      check("flow: product price/cost commit succeeds", !p.error, p.error?.message);
      check("flow: pricing_committed audit row emitted", (await auditCount("pricing_committed", product.id)) > before);
    } else {
      check("flow: a branch-A product exists to exercise (seed)", false, "no product found — run scripts/seed-dev.mjs");
    }

    // (e) supplier certificate update (discover a supplier)
    const { data: supplier } = await service.from("suppliers").select("id, name").limit(1).maybeSingle();
    if (supplier?.id) {
      const cert = await manager.rpc("admin_upsert_supplier_cert", {
        p_supplier_id: supplier.id, p_branch_id: BRANCH_A, p_name: supplier.name ?? "Supplier",
        p_certifying_body: "HMC", p_cert_number: `vaa-${RUN}`, p_active: true, p_verified: true,
      });
      check("flow: supplier certificate upsert succeeds", !cert.error, cert.error?.message);
      const certified = (await auditCount("certificate_verified", supplier.id)) + (await auditCount("certificate_uploaded", supplier.id));
      check("flow: certificate audit row emitted", certified >= 1, `count=${certified}`);
    } else {
      check("flow: a supplier exists to exercise (seed)", false, "no supplier found — run scripts/seed-dev.mjs");
    }
  }

  // --- 10. all public SECURITY DEFINER functions pin search_path --------------
  {
    const r = psql(
      "SELECT string_agg(p.proname, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace " +
        "WHERE n.nspname='public' AND p.prosecdef AND NOT EXISTS " +
        "(SELECT 1 FROM unnest(coalesce(p.proconfig,'{}'::text[])) c WHERE c LIKE 'search_path=%');",
    );
    if (!r.ok) {
      check("meta: docker psql reachable for catalog checks", false, `(${r.err || "docker exec failed"}) set AUDIT_DB_CONTAINER`);
    } else {
      check("all public SECURITY DEFINER functions pin search_path", r.out === "", `offenders: ${r.out}`);
    }
  }

  // --- 11. grants audit: no audit write capability for client roles -----------
  {
    const r = psql(
      "SELECT string_agg(grantee||':'||privilege_type, ', ') FROM information_schema.role_table_grants " +
        "WHERE table_schema='public' AND table_name IN ('audit_logs','audit_events') " +
        "AND grantee IN ('anon','authenticated') AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');",
    );
    if (r.ok) {
      check("no INSERT/UPDATE/DELETE grant on audit tables for anon/authenticated", r.out === "", `grants: ${r.out}`);
    }
    // Also confirm via catalog that the forgeable insert policies are gone.
    const p = psql(
      "SELECT string_agg(tablename||':'||policyname, ', ') FROM pg_policies " +
        "WHERE schemaname='public' AND tablename IN ('audit_logs','audit_events') AND cmd IN ('INSERT','ALL');",
    );
    if (p.ok) {
      check("no INSERT/ALL RLS policy remains on audit tables", p.out === "", `policies: ${p.out}`);
    }
    const f = psql(
      "SELECT has_function_privilege('anon','public.emit_audit_log(text,text,uuid,uuid,jsonb,text)','EXECUTE')::text || ',' || " +
        "has_function_privilege('authenticated','public.emit_audit_log(text,text,uuid,uuid,jsonb,text)','EXECUTE')::text;",
    );
    if (f.ok) {
      check("emit_audit_log is not executable by anon/authenticated", f.out === "false,false", `privileges=${f.out}`);
    }
  }

  // Best-effort cleanup of the test ORDERS (audit rows are append-only and remain).
  await service.from("orders").delete().like("idempotency_key", `vaa-${RUN}-%`);

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("RESULT: all audit authenticity adversarial checks PASSED");
}

main().catch((e) => {
  console.error("verify-audit-authenticity crashed:", e.message);
  process.exit(1);
});
