#!/usr/bin/env node

// Establish the operational precondition for DB verifiers that exercise trading
// writers in isolation. This uses the real authenticated checklist RPCs; it does
// not insert or forge a completed session through the service role.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const MANAGER_EMAIL = "manager@ptm.test";
const MANAGER_PASSWORD = "PlaiceTest123!";

const fileEnv = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) throw new Error("Local Supabase URL and anon key are required.");

const manager = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signInError } = await manager.auth.signInWithPassword({
  email: MANAGER_EMAIL,
  password: MANAGER_PASSWORD,
});
if (signInError) throw new Error(`Manager sign-in failed: ${signInError.message}`);

const { data: sessionId, error: startError } = await manager.rpc("ops_start_or_resume_session", {
  p_branch_id: BRANCH,
  p_kind: "opening",
  p_source: "test-precondition",
});
if (startError || !sessionId) throw new Error(`Opening start failed: ${startError?.message ?? "no session"}`);

for (const [stepKey, payload] of [
  ["fridge_temp", { value: 4 }],
  ["display_ready", {}],
  ["float_ready", { value: 100 }],
  ["open_sign", {}],
]) {
  const { error } = await manager.rpc("ops_record_step", {
    p_session_id: sessionId,
    p_step_key: stepKey,
    p_state: "done",
    p_payload: payload,
    p_source: "test-precondition",
    p_idempotency_key: `test-shop-day-open:${sessionId}:${stepKey}`,
  });
  if (error && !/finished/i.test(error.message)) throw new Error(`Opening step ${stepKey} failed: ${error.message}`);
}

const { error: completeError } = await manager.rpc("ops_complete_session", {
  p_session_id: sessionId,
  p_source: "test-precondition",
});
if (completeError) throw new Error(`Opening completion failed: ${completeError.message}`);

console.log(`Test Shop Day open: ${sessionId}`);
