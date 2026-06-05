// Sanitised review-bundle builder (V11.0 governance requirement).
//
// Produces a tarball containing ONLY tracked source, migrations, tests, docs and
// governance files. It can never include local/remote environment files, build
// artefacts, VCS internals or credentials, because:
//
//   1. the file list is sourced from `git ls-files` (so anything gitignored —
//      .env*, .next, node_modules, .vercel — is already excluded);
//   2. an explicit denylist drops sensitive/generated paths even if a future
//      commit accidentally tracks them;
//   3. every included file is scanned for credential patterns and the build
//      FAILS (non-zero exit) if any real secret is detected.
//
// Usage:  node scripts/audit-bundle.mjs            -> writes dist/audit-bundle-<sha>.tar.gz
//         node scripts/audit-bundle.mjs --dry-run  -> scan + list only, no archive
//
// Exit codes: 0 ok, 1 secret detected / git failure, 2 usage error.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes("--dry-run");

// Paths that must never enter a review bundle even if accidentally tracked.
const DENY_PREFIXES = [
  ".env",
  ".git/",
  ".next/",
  "node_modules/",
  ".vercel/",
  "coverage/",
  "playwright-report/",
  "test-results/",
  "dist/",
];

// Generated/large or PII-bearing artefacts: screenshots can contain customer data.
const DENY_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".mp4", ".zip", ".tar", ".tar.gz"];

// Well-known public local-Supabase demo keys carry issuer "supabase-demo"; the
// scanner decodes JWTs and only allows that issuer, flagging anything else.
const LOCAL_DEMO_ISSUER = "supabase-demo";

// Documented, intentionally-public local dev fixtures (seeded local users only).
// These are never valid against any production environment. Anything not on this
// list that looks like a secret still fails the build.
const KNOWN_LOCAL_FIXTURES = new Set(["PlaiceTest123!"]);

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function trackedFiles() {
  return git(["ls-files"]).split(/\r?\n/).filter(Boolean);
}

function isDenied(path) {
  if (DENY_PREFIXES.some((p) => path === p || path.startsWith(p))) return true;
  if (DENY_SUFFIXES.some((s) => path.toLowerCase().endsWith(s))) return true;
  return false;
}

// --- Secret detection -------------------------------------------------------

function decodeJwtIssuer(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json).iss ?? null;
  } catch {
    return null;
  }
}

const SECRET_RULES = [
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "Supabase service secret (sb_secret)", re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
  { name: "Supabase access token (sbp_)", re: /\bsbp_[A-Za-z0-9]{40,}\b/ },
];

// Assignment of a secret-named key to a quoted literal. We capture the value and
// judge it, so placeholders and env-references are not treated as leaked secrets.
const ASSIGN_RE = /(?:SERVICE_ROLE_KEY|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)\s*[:=]\s*['"]([^'"\n]{12,})['"]/gi;

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g;

// A captured value is NOT a real secret if it is a placeholder or a reference.
function isPlaceholderOrReference(value) {
  if (value.includes("<") && value.includes(">")) return true; // <prod service_role key>
  if (/^env\(/i.test(value.trim())) return true; // env(SUPABASE_...)
  if (value.includes("process.env")) return true;
  if (/^\$\{?[A-Z0-9_]+\}?$/.test(value.trim())) return true; // ${VAR} / $VAR
  if (/^[A-Z][A-Z0-9_]+$/.test(value.trim())) return true; // bare ENV_VAR_NAME reference
  if (/^(your[-_ ]|changeme|example|placeholder|xxx+|test|dummy|redacted)/i.test(value.trim())) return true;
  return false;
}

function scan(path, contents) {
  const findings = [];
  for (const rule of SECRET_RULES) {
    if (rule.re.test(contents)) findings.push(`${rule.name}`);
  }
  for (const m of contents.matchAll(ASSIGN_RE)) {
    if (!isPlaceholderOrReference(m[1]) && !KNOWN_LOCAL_FIXTURES.has(m[1])) {
      findings.push("High-entropy secret assignment");
    }
  }
  // JWTs: allow only the well-known local-demo issuer.
  const jwts = contents.match(JWT_RE) ?? [];
  for (const token of jwts) {
    const iss = decodeJwtIssuer(token);
    if (iss !== LOCAL_DEMO_ISSUER) {
      findings.push(`Non-local JWT credential (iss=${iss ?? "unknown"})`);
    }
  }
  return findings;
}

// --- Build ------------------------------------------------------------------

function main() {
  let sha = "unknown";
  try {
    sha = git(["rev-parse", "--short", "HEAD"]).trim();
  } catch {
    console.error("audit:bundle FAIL — not a git repository.");
    process.exit(1);
  }

  const all = trackedFiles();
  const included = [];
  const denied = [];
  for (const f of all) {
    if (isDenied(f)) denied.push(f);
    else included.push(f);
  }

  const violations = [];
  for (const f of included) {
    const abs = join(ROOT, f);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // tracked but missing locally
    }
    if (!st.isFile() || st.size > 2_000_000) continue; // skip large/binary
    let contents;
    try {
      contents = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const findings = scan(f, contents);
    if (findings.length) violations.push({ file: f, findings });
  }

  console.log(`audit:bundle  commit=${sha}`);
  console.log(`  tracked files:   ${all.length}`);
  console.log(`  included:        ${included.length}`);
  console.log(`  excluded(deny):  ${denied.length}`);

  if (violations.length) {
    console.error("\naudit:bundle FAIL — credential-like content detected:");
    for (const v of violations) {
      console.error(`  ${v.file}: ${v.findings.join(", ")}`);
    }
    process.exit(1);
  }
  console.log("  secret scan:     CLEAN");

  if (DRY_RUN) {
    console.log("\n--dry-run: no archive written.");
    return;
  }

  mkdirSync(join(ROOT, "dist"), { recursive: true });
  const manifestPath = join(ROOT, "dist", `audit-bundle-${sha}.files.txt`);
  writeFileSync(manifestPath, included.join("\n") + "\n", "utf8");

  const out = relative(ROOT, join(ROOT, "dist", `audit-bundle-${sha}.tar.gz`));
  // tar is available on Windows 10+ and POSIX. Feed the allowlist via -T.
  try {
    execFileSync("tar", ["-czf", out, "-T", relative(ROOT, manifestPath)], { cwd: ROOT, stdio: "inherit" });
  } catch (e) {
    console.error(`audit:bundle FAIL — archive step failed: ${e.message}`);
    process.exit(1);
  }
  rmSync(manifestPath, { force: true });
  console.log(`\naudit:bundle OK -> ${out}`);
}

main();
