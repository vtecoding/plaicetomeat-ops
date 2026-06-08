// verify-latest-backup.mjs
// V13.4 — finds the most recent backup directory, verifies encryption,
// checksum integrity, age, manifest completeness, and absence of raw SQL.
//
// Required env:
//   BACKUP_ENCRYPTION_KEY
//
// For strict production verification also set:
//   BACKUP_ENVIRONMENT=PRODUCTION
//   STRICT=1
//
// Optional:
//   BACKUP_OUTPUT_DIR  (default: ./backups)

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  decryptPayload,
  checksum,
  isBackupFresh,
  verifyManifestTables,
  isProductionBackup,
  isRawSqlPresent,
  checkFactory,
} from "./backup-lib.mjs";

function findLatestBackupDir(baseDir) {
  let entries;
  try {
    entries = readdirSync(baseDir)
      .filter((e) => e.startsWith("plaicetomeat-production-"))
      .sort()
      .reverse();
  } catch {
    throw new Error(`Backup directory "${baseDir}" not found — has a backup been run yet?`);
  }
  if (entries.length === 0) {
    throw new Error(`No backups found in "${baseDir}" — run backup-production.mjs first`);
  }
  return join(baseDir, entries[0]);
}

async function main() {
  const encKey = process.env.BACKUP_ENCRYPTION_KEY;
  const strict = process.env.STRICT === "1";
  const isProduction = process.env.BACKUP_ENVIRONMENT === "PRODUCTION";
  const baseDir = resolve(process.cwd(), process.env.BACKUP_OUTPUT_DIR ?? "backups");
  const { check, failures } = checkFactory();

  const backupDir = findLatestBackupDir(baseDir);
  console.log(`verify-latest-backup: ${backupDir}`);

  // 1. Manifest exists and parses
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
    check("manifest exists and is valid JSON", true);
  } catch (err) {
    check("manifest exists and is valid JSON", false, err.message);
    process.exit(1);
  }

  // 2. Encrypted archive exists
  const encFileName = manifest.encrypted_file;
  let encData;
  try {
    encData = readFileSync(join(backupDir, encFileName));
    check("encrypted archive exists", true);
  } catch {
    check("encrypted archive exists", false, `${encFileName} not found in ${backupDir}`);
    process.exit(1);
  }

  // 3. Checksum matches manifest
  const actualChecksum = `sha256:${checksum(encData)}`;
  check("checksum matches manifest", actualChecksum === manifest.encrypted_checksum,
    `expected ${manifest.encrypted_checksum}, got ${actualChecksum}`);

  // 4. Encrypted archive size sanity
  check("archive is not suspiciously small (> 100 bytes)", encData.length > 100,
    `only ${encData.length} bytes — likely empty or corrupt`);

  // 5. Can decrypt successfully (proves key matches and file is not corrupted)
  if (!encKey) {
    check("BACKUP_ENCRYPTION_KEY set", false, "BACKUP_ENCRYPTION_KEY is required for decryption verification");
  } else {
    try {
      decryptPayload(encData, encKey);
      check("decrypts successfully with provided key", true);
    } catch (err) {
      check("decrypts successfully with provided key", false, err.message);
    }
  }

  // 6. No raw SQL left in backup dir
  const fileNames = readdirSync(backupDir);
  check("no raw SQL in backup directory", !isRawSqlPresent(fileNames),
    fileNames.filter((f) => f.endsWith(".sql")).join(", "));

  // 7. All core tables present in manifest
  const tableCheck = verifyManifestTables(manifest);
  check("all core tables present in manifest", tableCheck.ok,
    tableCheck.missing.length > 0 ? `missing: ${tableCheck.missing.join(", ")}` : "");

  // 8. Backup age check (only in STRICT + PRODUCTION mode)
  if (strict && isProduction) {
    const fresh = isBackupFresh(manifest.created_at);
    check("backup is fresh (< 24h old)", fresh,
      `created ${manifest.created_at} — backup is stale`);
  }

  // 9. Environment label (only in STRICT + PRODUCTION mode)
  if (strict && isProduction) {
    check("manifest environment is PRODUCTION", isProductionBackup(manifest),
      `got "${manifest.environment}" — local/test backups do not certify production`);
  }

  // 10. Checksums file exists
  try {
    readFileSync(join(backupDir, "checksums.sha256"), "utf8");
    check("checksums.sha256 present", true);
  } catch {
    check("checksums.sha256 present", false, "checksums.sha256 not found");
  }

  console.log("");
  if (failures() > 0) {
    console.error(`RESULT: latest backup verification FAILED (${failures()} check(s) failed)`);
    process.exit(1);
  }
  console.log("RESULT: latest backup verification PASSED (BACKUP_CERTIFIED)");
  console.log(`  environment : ${manifest.environment}`);
  console.log(`  created at  : ${manifest.created_at}`);
  console.log(`  total rows  : ${manifest.row_count_total}`);
  console.log(`  tables      : ${manifest.core_tables_present.join(", ")}`);
}

main().catch((err) => {
  console.error("verify-latest-backup crashed:", err.message);
  process.exit(1);
});
