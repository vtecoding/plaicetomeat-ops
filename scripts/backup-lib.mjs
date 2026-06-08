// backup-lib.mjs
// Pure functions shared by all V13.4 backup/restore/verify scripts.
// No side effects — all I/O is in the calling scripts.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

// Magic bytes — identify our backup format and version
export const BACKUP_MAGIC = Buffer.from("PLAICE\x01\x00"); // 8 bytes

// Core tables that must be present in every certified production backup
export const CORE_TABLES = [
  "profiles",
  "orders",
  "order_items",
  "products",
  "inventory_batches",
  "audit_logs",
  "compliance_logs",
  "pricing_validations",
];

// Insertion order that respects FK dependencies during restore
export const RESTORE_ORDER = [
  "profiles",
  "products",
  "inventory_batches",
  "orders",
  "order_items",
  "audit_logs",
  "compliance_logs",
  "pricing_validations",
];

// Encryption parameters
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SALT_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const KEY_LEN = 32; // AES-256

// ─── Encryption ───────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext payload with AES-256-GCM.
 *
 * Output format (all concatenated as a single Buffer):
 *   [8  bytes] magic
 *   [32 bytes] scrypt salt
 *   [16 bytes] AES-GCM IV
 *   [16 bytes] GCM auth tag
 *   [variable] gzip-compressed encrypted ciphertext
 */
export function encryptPayload(plaintext, password) {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);

  const compressed = gzipSync(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([BACKUP_MAGIC, salt, iv, tag, encrypted]);
}

/**
 * Decrypt a buffer produced by encryptPayload.
 * Returns the original uncompressed plaintext as a Buffer.
 * Throws on format mismatch, wrong password, or tampered data.
 */
export function decryptPayload(ciphertext, password) {
  let pos = 0;
  const read = (n) => {
    const slice = ciphertext.slice(pos, pos + n);
    pos += n;
    return slice;
  };

  const magic = read(BACKUP_MAGIC.length);
  if (!magic.equals(BACKUP_MAGIC)) {
    throw new Error("Invalid backup file — magic bytes do not match. Is this a PlaiceToMeat backup?");
  }

  const salt = read(SALT_LEN);
  const iv = read(IV_LEN);
  const tag = read(TAG_LEN);
  const encrypted = ciphertext.slice(pos);

  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return gunzipSync(decrypted);
  } catch (err) {
    throw new Error(`Decryption failed — wrong key or tampered file: ${err.message}`);
  }
}

// ─── Checksums ────────────────────────────────────────────────────────────────

export function checksum(data) {
  return createHash("sha256").update(data).digest("hex");
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

export function buildManifest({ timestamp, environment, projectRef, rowCounts, migrationCount, backupMode, encryptedFile, encryptedChecksum }) {
  const coreTables = CORE_TABLES.filter((t) => rowCounts[t] !== undefined && rowCounts[t] !== null);
  return {
    backup_id: `${projectRef}-${timestamp}`,
    created_at: new Date().toISOString(),
    environment,
    source_project_ref: projectRef,
    backup_mode: backupMode,
    encryption: "aes-256-gcm-scrypt-n16384",
    encrypted_file: encryptedFile ?? null,
    encrypted_checksum: encryptedChecksum ?? null,
    core_tables_present: coreTables,
    row_counts: rowCounts,
    row_count_total: Object.values(rowCounts).reduce((s, n) => s + (n ?? 0), 0),
    migration_count: migrationCount ?? 0,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Throws if any required production backup env var is missing or wrong.
 * Returns a typed env object on success.
 */
export function validateBackupEnv(env) {
  if (env.BACKUP_ENVIRONMENT !== "PRODUCTION") {
    throw new Error(`BACKUP_ENVIRONMENT must be "PRODUCTION" — got "${env.BACKUP_ENVIRONMENT ?? "(not set)"}" (refuse to run in non-production mode)`);
  }
  if (env.STRICT !== "1") {
    throw new Error(`STRICT must be "1" — production backup requires strict mode`);
  }
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BACKUP_ENCRYPTION_KEY"];
  for (const key of required) {
    if (!env[key]) throw new Error(`${key} is required but not set`);
  }
  return {
    SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    BACKUP_ENCRYPTION_KEY: env.BACKUP_ENCRYPTION_KEY,
    SUPABASE_DB_URL: env.SUPABASE_DB_URL ?? null,
    CANONICAL_BRANCH_ID: env.CANONICAL_BRANCH_ID ?? null,
    BACKUP_OUTPUT_DIR: env.BACKUP_OUTPUT_DIR ?? "backups",
    BACKUP_KEEP_RAW: env.BACKUP_KEEP_RAW === "1",
  };
}

// ─── Checks ───────────────────────────────────────────────────────────────────

export function isBackupFresh(createdAt, maxAgeMs = 24 * 60 * 60 * 1000) {
  return Date.now() - new Date(createdAt).getTime() <= maxAgeMs;
}

export function verifyManifestTables(manifest) {
  const missing = CORE_TABLES.filter((t) => !manifest.core_tables_present.includes(t));
  return { ok: missing.length === 0, missing };
}

export function isProductionBackup(manifest) {
  return manifest.environment === "PRODUCTION";
}

export function isRawSqlPresent(fileNames) {
  return fileNames.some((f) => f.endsWith(".sql") || f.endsWith(".json.raw"));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatTimestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

export function backupFileName(timestamp) {
  return `plaicetomeat-production-${timestamp}.backup.enc`;
}

export function extractProjectRef(supabaseUrl) {
  const match = String(supabaseUrl).match(/https?:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : "unknown";
}

export function checkFactory() {
  let count = 0;
  return {
    check(name, condition, detail = "") {
      if (condition) console.log(`  PASS ${name}`);
      else {
        count += 1;
        console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`);
      }
    },
    failures() {
      return count;
    },
  };
}
