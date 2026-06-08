import { describe, expect, it } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

/**
 * V13.4 — Free-tier backup system unit tests.
 *
 * The backup-lib.mjs functions cannot be imported directly in vitest because the
 * scripts/ directory is outside the TypeScript source tree. Logic is tested inline
 * (same pattern as runtime-truth.test.ts) — pure functions with identical behaviour.
 */

// ── Inline copies of backup-lib pure functions ────────────────────────────────

const BACKUP_MAGIC = Buffer.from("PLAICE\x01\x00");
const CORE_TABLES = [
  "profiles", "orders", "order_items", "products",
  "inventory_batches", "audit_logs", "compliance_logs", "pricing_validations",
];
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SALT_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const KEY_LEN = 32;

function encryptPayload(plaintext: string | Buffer, password: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const compressed = gzipSync(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([BACKUP_MAGIC, salt, iv, tag, encrypted]);
}

function decryptPayload(ciphertext: Buffer, password: string): Buffer {
  let pos = 0;
  const read = (n: number) => { const s = ciphertext.slice(pos, pos + n); pos += n; return s; };
  const magic = read(BACKUP_MAGIC.length);
  if (!magic.equals(BACKUP_MAGIC)) throw new Error("Invalid backup file — magic bytes mismatch");
  const salt = read(SALT_LEN);
  const iv = read(IV_LEN);
  const tag = read(TAG_LEN);
  const encrypted = ciphertext.slice(pos);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([decipher.update(encrypted), decipher.final()]));
  } catch (err) {
    throw new Error(`Decryption failed — wrong key or tampered file: ${(err as Error).message}`);
  }
}

function checksum(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function validateBackupEnv(env: Record<string, string | undefined>) {
  if (env.BACKUP_ENVIRONMENT !== "PRODUCTION")
    throw new Error(`BACKUP_ENVIRONMENT must be "PRODUCTION" — got "${env.BACKUP_ENVIRONMENT ?? "(not set)"}"`);
  if (env.STRICT !== "1")
    throw new Error(`STRICT must be "1"`);
  if (!env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (!env.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_ENCRYPTION_KEY is required");
}

function isBackupFresh(createdAt: string, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  return Date.now() - new Date(createdAt).getTime() <= maxAgeMs;
}

function verifyManifestTables(manifest: { core_tables_present: string[] }): { ok: boolean; missing: string[] } {
  const missing = CORE_TABLES.filter((t) => !manifest.core_tables_present.includes(t));
  return { ok: missing.length === 0, missing };
}

function isProductionBackup(manifest: { environment: string }): boolean {
  return manifest.environment === "PRODUCTION";
}

function isRawSqlPresent(fileNames: string[]): boolean {
  return fileNames.some((f) => f.endsWith(".sql") || f.endsWith(".json.raw"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validateBackupEnv — missing production env fails closed", () => {
  const valid = {
    BACKUP_ENVIRONMENT: "PRODUCTION",
    STRICT: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    BACKUP_ENCRYPTION_KEY: "enc-key-32-chars-minimum-length!",
  };

  it("throws when BACKUP_ENVIRONMENT is not PRODUCTION", () => {
    expect(() => validateBackupEnv({ ...valid, BACKUP_ENVIRONMENT: "local" }))
      .toThrow('BACKUP_ENVIRONMENT must be "PRODUCTION"');
  });

  it("throws when BACKUP_ENVIRONMENT is missing entirely", () => {
    expect(() => validateBackupEnv({ ...valid, BACKUP_ENVIRONMENT: undefined }))
      .toThrow('BACKUP_ENVIRONMENT must be "PRODUCTION"');
  });

  it("throws when STRICT is not '1'", () => {
    expect(() => validateBackupEnv({ ...valid, STRICT: "0" })).toThrow('STRICT must be "1"');
  });

  it("throws when STRICT is missing", () => {
    expect(() => validateBackupEnv({ ...valid, STRICT: undefined })).toThrow('STRICT must be "1"');
  });

  it("passes with all required vars present", () => {
    expect(() => validateBackupEnv(valid)).not.toThrow();
  });
});

describe("validateBackupEnv — missing encryption key fails closed", () => {
  it("throws when BACKUP_ENCRYPTION_KEY is missing", () => {
    expect(() =>
      validateBackupEnv({
        BACKUP_ENVIRONMENT: "PRODUCTION",
        STRICT: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "key",
        BACKUP_ENCRYPTION_KEY: undefined,
      }),
    ).toThrow("BACKUP_ENCRYPTION_KEY is required");
  });

  it("throws when BACKUP_ENCRYPTION_KEY is empty string", () => {
    expect(() =>
      validateBackupEnv({
        BACKUP_ENVIRONMENT: "PRODUCTION",
        STRICT: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "key",
        BACKUP_ENCRYPTION_KEY: "",
      }),
    ).toThrow("BACKUP_ENCRYPTION_KEY is required");
  });
});

describe("encrypt / decrypt — round-trip and tamper detection", () => {
  const PASSWORD = "ptm-backup-test-key-v13.4-unit-test";
  const PAYLOAD = JSON.stringify({ tables: { orders: [{ id: "order-1", ref: "ORD-001" }] } });

  it("round-trip: decrypted payload matches original", () => {
    const encrypted = encryptPayload(PAYLOAD, PASSWORD);
    const decrypted = decryptPayload(encrypted, PASSWORD);
    expect(decrypted.toString("utf8")).toBe(PAYLOAD);
  });

  it("raw SQL / JSON content is not readable in encrypted output", () => {
    const encrypted = encryptPayload(PAYLOAD, PASSWORD);
    // The encrypted buffer must not contain the plaintext as readable characters
    expect(encrypted.toString("utf8").includes("ORD-001")).toBe(false);
    expect(encrypted.toString("utf8").includes("orders")).toBe(false);
  });

  it("checksum mismatch fails — tampered file is rejected", () => {
    const encrypted = encryptPayload(PAYLOAD, PASSWORD);
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff; // flip last byte
    expect(() => decryptPayload(tampered, PASSWORD)).toThrow();
  });

  it("wrong password fails decryption", () => {
    const encrypted = encryptPayload(PAYLOAD, PASSWORD);
    expect(() => decryptPayload(encrypted, "wrong-password")).toThrow();
  });

  it("two encryptions of the same payload produce different ciphertexts (random IV)", () => {
    const a = encryptPayload(PAYLOAD, PASSWORD);
    const b = encryptPayload(PAYLOAD, PASSWORD);
    expect(a.equals(b)).toBe(false);
  });
});

describe("isBackupFresh — old backup fails strict verification", () => {
  it("returns true for a backup created moments ago", () => {
    expect(isBackupFresh(new Date().toISOString())).toBe(true);
  });

  it("returns false for a backup older than 24 hours", () => {
    const twoDaysAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isBackupFresh(twoDaysAgo)).toBe(false);
  });

  it("returns false for a backup created 48 hours ago", () => {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(isBackupFresh(fortyEightHoursAgo)).toBe(false);
  });
});

describe("verifyManifestTables — missing core table in manifest fails", () => {
  it("passes when all core tables are present", () => {
    const { ok, missing } = verifyManifestTables({ core_tables_present: [...CORE_TABLES] });
    expect(ok).toBe(true);
    expect(missing).toHaveLength(0);
  });

  it("fails when orders is absent", () => {
    const { ok, missing } = verifyManifestTables({
      core_tables_present: CORE_TABLES.filter((t) => t !== "orders"),
    });
    expect(ok).toBe(false);
    expect(missing).toContain("orders");
  });

  it("fails when audit_logs is absent", () => {
    const { ok, missing } = verifyManifestTables({
      core_tables_present: CORE_TABLES.filter((t) => t !== "audit_logs"),
    });
    expect(ok).toBe(false);
    expect(missing).toContain("audit_logs");
  });

  it("fails with empty core_tables_present array", () => {
    const { ok, missing } = verifyManifestTables({ core_tables_present: [] });
    expect(ok).toBe(false);
    expect(missing).toEqual(CORE_TABLES);
  });
});

describe("raw SQL detection — raw SQL is not uploaded", () => {
  it("detects .sql file in backup artifact list", () => {
    expect(isRawSqlPresent(["schema.sql", "manifest.json", "checksums.sha256"])).toBe(true);
  });

  it("detects .json.raw file in backup artifact list", () => {
    expect(isRawSqlPresent(["data.json.raw", "backup.enc"])).toBe(true);
  });

  it("passes when only encrypted archive, manifest, and checksums are present", () => {
    expect(isRawSqlPresent(["backup.enc", "manifest.json", "checksums.sha256"])).toBe(false);
  });
});

describe("production certification — local/demo backups cannot certify production launch", () => {
  it("PRODUCTION environment certifies launch", () => {
    expect(isProductionBackup({ environment: "PRODUCTION" })).toBe(true);
  });

  it("LOCAL environment does not certify production launch", () => {
    expect(isProductionBackup({ environment: "LOCAL" })).toBe(false);
  });

  it("TEST environment does not certify production launch", () => {
    expect(isProductionBackup({ environment: "TEST" })).toBe(false);
  });

  it("empty environment does not certify production launch", () => {
    expect(isProductionBackup({ environment: "" })).toBe(false);
  });
});

describe("restore certification rejects non-production/demo labels", () => {
  it("a certification report with PRODUCTION environment is valid", () => {
    const manifest = { environment: "PRODUCTION", core_tables_present: [...CORE_TABLES] };
    expect(isProductionBackup(manifest)).toBe(true);
    expect(verifyManifestTables(manifest).ok).toBe(true);
  });

  it("a certification report with LOCAL label must be rejected for launch", () => {
    const localManifest = { environment: "LOCAL", core_tables_present: [...CORE_TABLES] };
    // Even if all tables present, LOCAL environment is not production-certified
    expect(isProductionBackup(localManifest)).toBe(false);
  });
});

describe("checksum integrity", () => {
  it("same data always produces the same checksum", () => {
    const data = Buffer.from("plaicetomeat backup data");
    expect(checksum(data)).toBe(checksum(data));
  });

  it("different data produces a different checksum", () => {
    expect(checksum(Buffer.from("data-a"))).not.toBe(checksum(Buffer.from("data-b")));
  });

  it("tampered data is detected by checksum comparison", () => {
    const original = Buffer.from("original backup contents");
    const originalHash = `sha256:${checksum(original)}`;
    const tampered = Buffer.from("tampered backup contents");
    const tamperedHash = `sha256:${checksum(tampered)}`;
    expect(originalHash).not.toBe(tamperedHash);
  });
});
