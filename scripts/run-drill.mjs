// Temporary drill runner — loads .env.backup-drill and runs the V13.4 drill steps.
// Delete this file after the drill is complete.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const envFile = resolve(process.cwd(), ".env.backup-drill");
const lines = readFileSync(envFile, "utf8").split("\n");
const env = { ...process.env };
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

const step = process.argv[2] ?? "backup";

function run(args, label) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`STEP: ${label}`);
  console.log("=".repeat(60));
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit", cwd: process.cwd() });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

if (step === "backup") {
  run(["scripts/backup-production.mjs"], "Production backup");
} else if (step === "verify-backup") {
  env.BACKUP_OUTPUT_DIR = "backups";
  run(["scripts/verify-latest-backup.mjs"], "Verify latest backup");
} else if (step === "restore") {
  // Find latest encrypted backup file
  const { readdirSync } = await import("node:fs");
  const backupBase = resolve(process.cwd(), "backups");
  const dirs = readdirSync(backupBase).filter(d => d.startsWith("plaicetomeat-production-")).sort().reverse();
  if (!dirs[0]) { console.error("No backup dir found"); process.exit(1); }
  const dir = resolve(backupBase, dirs[0]);
  const enc = readdirSync(dir).find(f => f.endsWith(".backup.enc"));
  if (!enc) { console.error("No .backup.enc in " + dir); process.exit(1); }
  env.BACKUP_FILE = resolve(dir, enc);
  run(["scripts/restore-backup-local.mjs"], "Restore backup to throwaway project");
} else if (step === "parity") {
  env.RECOVERY_ENVIRONMENT = "PRODUCTION";
  // V13.4: use service-role-only parity script (no test user / local Supabase needed)
  run(["scripts/verify-restore-parity.mjs"], "Parity + integrity check");
} else if (step === "certify") {
  run(["scripts/generate-v134-certification.mjs"], "Generate V13.4 certification report");
} else {
  console.error("Unknown step:", step);
  console.error("Usage: node scripts/run-drill.mjs [backup|verify-backup|restore|parity|certify]");
  process.exit(1);
}
