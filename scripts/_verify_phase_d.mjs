import { createClient } from "@supabase/supabase-js";
const URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SR =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const branchA = "00000000-0000-4000-8000-000000000001";
const svc = createClient(URL, SR, { auth: { persistSession: false } });
async function asUser(email) {
  const c = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "PlaiceTest123!" });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}
const fails = [];
const ok = (cond, label) => { if (!cond) fails.push(label); };
const mgr = await asUser("manager@ptm.test");
const staff = await asUser("staff@ptm.test");

// staff rejected creating window
let r = await staff.rpc("admin_create_pickup_window", { p_branch_id: branchA, p_label: "Hack", p_start_time: "09:00", p_end_time: "10:00" });
ok(!!r.error, "staff create window rejected");

// invalid: start >= end
r = await mgr.rpc("admin_create_pickup_window", { p_branch_id: branchA, p_label: "Bad", p_start_time: "10:00", p_end_time: "09:00" });
ok(!!r.error, "start>=end rejected");

// valid create
r = await mgr.rpc("admin_create_pickup_window", { p_branch_id: branchA, p_label: "Verify Window", p_start_time: "20:00", p_end_time: "21:00", p_max_orders: 5, p_days_of_week: [1,2,3] });
ok(!r.error, "manager create window: " + (r.error?.message ?? "ok"));
const winId = r.data;

// disable
r = await mgr.rpc("admin_set_pickup_window_active", { p_window_id: winId, p_is_active: false });
ok(!r.error, "disable window");

// re-enable
r = await mgr.rpc("admin_set_pickup_window_active", { p_window_id: winId, p_is_active: true });
ok(!r.error, "enable window");

// closure: staff rejected
r = await staff.rpc("admin_create_shop_closure", { p_branch_id: branchA, p_close_date: "2026-12-25", p_reason: "x" });
ok(!!r.error, "staff create closure rejected");

// manager create closure
r = await mgr.rpc("admin_create_shop_closure", { p_branch_id: branchA, p_close_date: "2026-12-25", p_reason: "Christmas" });
ok(!r.error, "manager create closure: " + (r.error?.message ?? "ok"));
const closureId = r.data;

// audit events present
const { data: winAudit } = await svc.from("audit_logs").select("event_type").eq("target_id", winId);
const we = (winAudit ?? []).map((a) => a.event_type);
ok(we.includes("pickup_window_created") && we.includes("pickup_window_disabled") && we.includes("pickup_window_updated"), "window audit events: " + JSON.stringify(we));
const { data: clAudit } = await svc.from("audit_logs").select("event_type").eq("target_id", closureId);
ok((clAudit ?? []).some((a) => a.event_type === "shop_closure_created"), "closure_created audit");

// remove closure
r = await mgr.rpc("admin_remove_shop_closure", { p_closure_id: closureId });
ok(!r.error, "remove closure");

// cleanup window
await svc.from("pickup_windows").delete().eq("id", winId);

console.log(fails.length === 0 ? "PHASE_D=PASS" : "PHASE_D=FAIL " + JSON.stringify(fails));
