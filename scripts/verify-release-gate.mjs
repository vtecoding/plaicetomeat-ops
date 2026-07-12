// PTM Phase-1 remediation — release promotion gate (Phase E).
//
// A single fail-closed gate that refuses to promote a deployment when the
// production database and the release candidate are not reconcilable. It blocks
// when ANY of these hold:
//   1. the committed migration manifest does not match supabase/migrations
//      (curated-subset / checksum drift — the PTM-OBS-012 class);
//   2. the deployed build identifier is unknown or does not match the release
//      commit (PTM-REL-009);
//   3. production schema is behind the required migration head (PTM-REL-002);
//   4. the required security-lock migrations are not applied in production
//      (phase-3 truth lock + next_order_ref revoke);
//   5. no recent successful verified backup exists (PTM-DR-001).
//
// Application deployment and schema migration are SEPARATE steps; this gate makes
// their required ordering explicit: schema must be at head (and backed up) BEFORE
// an app build that depends on it is promoted.
//
// Modes (env RELEASE_GATE_MODE):
//   release (default) — full gate; fails closed if prod creds/signals are absent.
//   local             — self-consistency only (manifest); prod checks reported SKIP.
//
// Prod signals use read-only RPCs (get_applied_migration_versions,
// get_backup_freshness) via SUPABASE_URL + a key. No destructive access.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const MODE = (process.env.RELEASE_GATE_MODE ?? "release").toLowerCase();
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MANIFEST_FILE = join(process.cwd(), "src", "lib", "server", "migration-manifest.generated.ts");
const BACKUP_MAX_AGE_HOURS = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 48);

// The migrations whose ABSENCE from prod re-opens a P0/P1/P3 finding. Parity
// already covers them, but we assert them by name so the gate's intent is legible
// and a future manifest reshuffle cannot quietly drop the security floor.
const REQUIRED_SECURITY_MIGRATIONS = [
  "202606290900", // phase0 truth lock
  "202607101200", // phase3 lock products + events
  "202607110900", // revoke next_order_ref from anon/authenticated
];

let failures = 0;
let skips = 0;
const line = (s) => console.log(s);
function pass(name, detail = "") { line(`  PASS  ${name}${detail ? "  ::  " + detail : ""}`); }
function fail(name, detail = "") { failures++; line(`  FAIL  ${name}${detail ? "  ::  " + detail : ""}`); }
function skip(name, detail = "") { skips++; line(`  SKIP  ${name}${detail ? "  ::  " + detail : ""}`); }

function deriveManifest() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const entries = files.map((file) => {
    const version = file.slice(0, file.indexOf("_"));
    const checksum = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(/\r\n/g, "\n")).digest("hex");
    return { version, file, checksum };
  });
  const manifestChecksum = createHash("sha256")
    .update(entries.map((m) => `${m.version}:${m.file}:${m.checksum}`).join("\n"))
    .digest("hex");
  return { entries, versions: entries.map((e) => e.version), head: entries.at(-1)?.version ?? "", manifestChecksum };
}

// ── 1. Manifest self-consistency (no curated-subset / checksum drift) ────────
const derived = deriveManifest();
let committedChecksum = null;
try {
  const src = readFileSync(MANIFEST_FILE, "utf8");
  committedChecksum = src.match(/MIGRATION_MANIFEST_CHECKSUM = "([0-9a-f]+)"/)?.[1] ?? null;
} catch {
  committedChecksum = null;
}
if (committedChecksum === derived.manifestChecksum) {
  pass("migration manifest matches supabase/migrations", `head ${derived.head}, ${derived.versions.length} migrations`);
} else {
  fail("migration manifest matches supabase/migrations", `committed=${String(committedChecksum).slice(0, 12)} derived=${derived.manifestChecksum.slice(0, 12)} — run gen:migration-manifest`);
}

// ── 2. Build identity known + reconciled to the release commit ───────────────
function gitHead() {
  try { return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const releaseSha = (process.env.EXPECTED_RELEASE_SHA || process.env.PTM_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
const head = gitHead();
if (!releaseSha) {
  if (MODE === "local") skip("build identity reconciled to release commit", "no build SHA in env (local mode)");
  else fail("build identity reconciled to release commit", "no PTM_BUILD_SHA / VERCEL_GIT_COMMIT_SHA / EXPECTED_RELEASE_SHA");
} else if (head && (releaseSha === head || head.startsWith(releaseSha) || releaseSha.startsWith(head))) {
  pass("build identity reconciled to release commit", `${releaseSha.slice(0, 7)}`);
} else {
  fail("build identity reconciled to release commit", `build=${releaseSha.slice(0, 12)} head=${String(head).slice(0, 12)}`);
}

// ── Prod signals (RPC, read-only) ────────────────────────────────────────────
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function rpc(name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function prodChecks() {
  if (!url || !key) {
    if (MODE === "local") {
      skip("production migration parity", "no prod creds (local mode)");
      skip("required security-lock migrations applied", "no prod creds (local mode)");
      skip("recent verified backup exists", "no prod creds (local mode)");
      return;
    }
    fail("production migration parity", "SUPABASE_URL / key not set — cannot verify prod (fail closed)");
    fail("required security-lock migrations applied", "no prod creds (fail closed)");
    fail("recent verified backup exists", "no prod creds (fail closed)");
    return;
  }

  // 3 + 4. Migration parity + named security locks.
  try {
    const applied = new Set((await rpc("get_applied_migration_versions")).map((r) => String(r.version)));
    const missing = derived.versions.filter((v) => !applied.has(v));
    if (missing.length === 0) pass("production migration parity", `${derived.versions.length}/${derived.versions.length} at head ${derived.head}`);
    else fail("production migration parity", `behind — missing ${missing.join(", ")}`);

    const missingSec = REQUIRED_SECURITY_MIGRATIONS.filter((v) => !applied.has(v));
    if (missingSec.length === 0) pass("required security-lock migrations applied", REQUIRED_SECURITY_MIGRATIONS.join(", "));
    else fail("required security-lock migrations applied", `missing ${missingSec.join(", ")}`);
  } catch (err) {
    fail("production migration parity", err.message);
    fail("required security-lock migrations applied", "parity probe failed (fail closed)");
  }

  // 5. Backup freshness.
  try {
    const rows = await rpc("get_backup_freshness", { p_max_age_hours: BACKUP_MAX_AGE_HOURS });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.has_success && row.is_fresh) pass("recent verified backup exists", `age ${Math.floor((row.age_seconds ?? 0) / 3600)}h`);
    else fail("recent verified backup exists", row ? `has_success=${row.has_success} is_fresh=${row.is_fresh}` : "no freshness row");
  } catch (err) {
    fail("recent verified backup exists", `${err.message} (fail closed)`);
  }
}

await prodChecks();

line("");
line(`Release gate (${MODE}): ${failures} failed, ${skips} skipped.`);
if (failures > 0) {
  line("PROMOTION BLOCKED — resolve the failing controls before deploying.");
  process.exitCode = 1;
} else {
  line("PROMOTION ALLOWED — all release controls satisfied.");
  process.exitCode = 0;
}
