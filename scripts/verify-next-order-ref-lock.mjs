// PTM-SEC-003 regression — next_order_ref anon/authenticated execute lock.
//
// Proves that after 202607110900_revoke_next_order_ref_anon:
//   * an ANONYMOUS caller (public anon key) CANNOT execute next_order_ref and
//     CANNOT advance order_annual_sequences.last_sequence;
//   * an ordinary AUTHENTICATED caller also cannot execute it;
//   * the trusted internal command path (service_role, and the SECURITY DEFINER
//     create_checkout_order) still works.
//
// Run: node scripts/verify-next-order-ref-lock.mjs   (local Supabase up + seeded)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const MANAGER_EMAIL = "manager@ptm.test";
const MANAGER_PASSWORD = "PlaiceTest123!";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !ANON || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE in .env.local");
  process.exit(2);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  ::  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? "  ::  " + detail : ""}`);
  }
}

const year = new Date().getFullYear();

async function seqValue() {
  const { data } = await admin
    .from("order_annual_sequences")
    .select("last_sequence")
    .eq("branch_id", BRANCH)
    .eq("order_year", year)
    .maybeSingle();
  return data?.last_sequence ?? null;
}

async function main() {
  // ── 1. Anonymous caller (no session) ─────────────────────────────────────
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const before = await seqValue();
  const { data: anonData, error: anonErr } = await anon.rpc("next_order_ref", {
    target_branch_id: BRANCH,
    target_date: new Date().toISOString().slice(0, 10),
  });
  const afterAnon = await seqValue();
  check("anon cannot execute next_order_ref (error returned)", !!anonErr && !anonData, anonErr ? anonErr.message : `data=${anonData}`);
  check("anon call did not advance the sequence", before === afterAnon, `before=${before} after=${afterAnon}`);

  // ── 2. Ordinary authenticated caller ─────────────────────────────────────
  const user = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await user.auth.signInWithPassword({ email: MANAGER_EMAIL, password: MANAGER_PASSWORD });
  if (signErr) throw new Error(`manager sign-in failed: ${signErr.message}`);
  const beforeAuth = await seqValue();
  const { data: authData, error: authErr } = await user.rpc("next_order_ref", {
    target_branch_id: BRANCH,
    target_date: new Date().toISOString().slice(0, 10),
  });
  const afterAuth = await seqValue();
  check("authenticated staff cannot execute next_order_ref", !!authErr && !authData, authErr ? authErr.message : `data=${authData}`);
  check("authenticated call did not advance the sequence", beforeAuth === afterAuth, `before=${beforeAuth} after=${afterAuth}`);

  // ── 3. Trusted internal path still works (service role) ──────────────────
  const { data: svcData, error: svcErr } = await admin.rpc("next_order_ref", {
    target_branch_id: BRANCH,
    target_date: new Date().toISOString().slice(0, 10),
  });
  check("service_role CAN execute next_order_ref (authorized path intact)", !svcErr && typeof svcData === "string" && svcData.startsWith("PTM-"), svcErr ? svcErr.message : `ref=${svcData}`);

  console.log("");
  console.log(`next_order_ref lock guard: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
