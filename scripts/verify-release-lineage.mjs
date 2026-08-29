#!/usr/bin/env node
// Prevent a pre-V18 source tree from becoming a release candidate again.
// Git ancestry is authoritative when history is available; source archives fall
// back to the immutable migration-baseline check so Vercel/build bundles remain
// reproducible without a .git directory.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CERTIFIED_V18_CHECKPOINT = "bafeadf54663f2babab93229396f8763796afcd0";
const CERTIFIED_SCHEMA_BASELINE = "202607161505";
const migrationDir = join(process.cwd(), "supabase", "migrations");
const requireClean = process.argv.includes("--require-clean");

function fail(message) {
  console.error(`release-lineage: FAIL - ${message}`);
  process.exit(1);
}

if (!existsSync(migrationDir)) fail("supabase/migrations is missing");

const versions = readdirSync(migrationDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => file.split("_")[0])
  .sort();

if (!versions.includes(CERTIFIED_SCHEMA_BASELINE)) {
  fail(`certified V18 schema baseline ${CERTIFIED_SCHEMA_BASELINE} is missing`);
}

const head = versions.at(-1) ?? "";
if (head < CERTIFIED_SCHEMA_BASELINE) {
  fail(`migration head ${head || "none"} predates certified baseline ${CERTIFIED_SCHEMA_BASELINE}`);
}

if (existsSync(join(process.cwd(), ".git"))) {
  let checkpointAvailable = true;
  try {
    execFileSync("git", ["cat-file", "-e", `${CERTIFIED_V18_CHECKPOINT}^{commit}`], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
  } catch {
    checkpointAvailable = false;
  }

  if (checkpointAvailable) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", CERTIFIED_V18_CHECKPOINT, "HEAD"], {
        cwd: process.cwd(),
        stdio: "ignore",
      });
    } catch {
      fail(`HEAD is not descended from certified checkpoint ${CERTIFIED_V18_CHECKPOINT.slice(0, 7)}`);
    }
  } else {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    if (shallow !== "true") {
      fail(`certified checkpoint ${CERTIFIED_V18_CHECKPOINT.slice(0, 7)} is missing from full Git history`);
    }
  }
  if (requireClean) {
    const dirty = execFileSync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    if (dirty) fail("release worktree is dirty; commit the exact artifact before promotion");
  }
  const lineage = checkpointAvailable
    ? `HEAD descends from ${CERTIFIED_V18_CHECKPOINT.slice(0, 7)}`
    : `shallow CI clone contains certified schema baseline ${CERTIFIED_SCHEMA_BASELINE}`;
  console.log(`release-lineage: PASS - ${lineage}; schema head ${head}`);
} else {
  console.log(`release-lineage: PASS - source archive contains certified schema baseline; schema head ${head}`);
}
