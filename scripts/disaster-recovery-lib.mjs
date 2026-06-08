import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export const BRANCH_A = "00000000-0000-4000-8000-000000000001";
export const BRANCH_B = "00000000-0000-4000-8000-000000000002";
export const PASSWORD = "PlaiceTest123!";

export const TABLE_GROUPS = [
  { label: "profiles", tables: ["profiles"] },
  { label: "orders", tables: ["orders"] },
  { label: "order_items", tables: ["order_items"] },
  { label: "products", tables: ["products"] },
  { label: "inventory", tables: ["inventory_batches", "inventory_movements"] },
  { label: "audit_logs", tables: ["audit_logs"] },
  { label: "compliance_logs", tables: ["compliance_logs"] },
  { label: "pricing_validations", tables: ["pricing_validations"] },
];

export const SAMPLE_SPECS = [
  {
    label: "latest order",
    table: "orders",
    orderColumn: "created_at",
    ascending: false,
    fields: "id, branch_id, order_ref, customer_name, status, subtotal, created_at, updated_at",
  },
  {
    label: "oldest order",
    table: "orders",
    orderColumn: "created_at",
    ascending: true,
    fields: "id, branch_id, order_ref, customer_name, status, subtotal, created_at, updated_at",
  },
  {
    label: "random order",
    table: "orders",
    orderColumn: "id",
    ascending: true,
    fields: "id, branch_id, order_ref, customer_name, status, subtotal, created_at, updated_at",
    middle: true,
  },
  {
    label: "latest audit event",
    table: "audit_logs",
    orderColumn: "created_at",
    ascending: false,
    fields: "id, branch_id, actor_id, event_type, target_type, target_id, metadata, created_at",
  },
  {
    label: "oldest audit event",
    table: "audit_logs",
    orderColumn: "created_at",
    ascending: true,
    fields: "id, branch_id, actor_id, event_type, target_type, target_id, metadata, created_at",
  },
  {
    label: "latest compliance log",
    table: "compliance_logs",
    orderColumn: "created_at",
    ascending: false,
    fields: "id, branch_id, log_date, status, cleaning_completed, sanitisation_completed, waste_checked, created_at, updated_at",
  },
  {
    label: "latest pricing validation",
    table: "pricing_validations",
    orderColumn: "reviewed_at",
    ascending: false,
    fields: "id, branch_id, species, cut_id, decision, variance_pct, reviewed_at, updated_at",
  },
];

export function anonClient() {
  return createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function serviceClient(url = URL, key = SERVICE) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function sessionClient(email) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

export function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function newRunId() {
  return randomUUID().slice(0, 8);
}

export async function countRows(client, table) {
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

export async function collectParity(sourceClient, restoredClient) {
  const results = [];
  for (const group of TABLE_GROUPS) {
    let source = 0;
    let restored = 0;
    for (const table of group.tables) {
      source += await countRows(sourceClient, table);
      restored += await countRows(restoredClient, table);
    }
    results.push({
      table: group.label,
      source,
      restored,
      variance: restored - source,
      status: source === restored ? "PASS" : "FAIL",
      physical_tables: group.tables,
    });
  }
  return results;
}

export function parityStatus(results) {
  return results.every((row) => row.status === "PASS") ? "PARITY_PASSED" : "PARITY_FAILED";
}

export function totalSourceRows(results) {
  return results.reduce((sum, row) => sum + row.source, 0);
}

export function totalRestoredRows(results) {
  return results.reduce((sum, row) => sum + row.restored, 0);
}

function normalizeRow(row) {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function sourceSample(client, spec) {
  const count = await countRows(client, spec.table);
  if (count === 0) return { row: null, count };
  let query = client
    .from(spec.table)
    .select(spec.fields)
    .order(spec.orderColumn, { ascending: spec.ascending, nullsFirst: false });
  if (spec.middle) {
    const offset = Math.floor(count / 2);
    query = query.range(offset, offset);
  } else {
    query = query.limit(1);
  }
  const { data, error } = await query;
  if (error) throw new Error(`sample ${spec.label}: ${error.message}`);
  return { row: data?.[0] ?? null, count };
}

async function rowById(client, table, fields, id) {
  const { data, error } = await client.from(table).select(fields).eq("id", id).maybeSingle();
  if (error) throw new Error(`restore sample ${table}/${id}: ${error.message}`);
  return data ?? null;
}

export async function collectIntegrity(sourceClient, restoredClient, { requireSamples = false } = {}) {
  const results = [];
  for (const spec of SAMPLE_SPECS) {
    const source = await sourceSample(sourceClient, spec);
    if (!source.row) {
      results.push({
        sample: spec.label,
        table: spec.table,
        status: requireSamples ? "FAIL" : "PASS",
        detail: requireSamples ? "missing source sample" : "no source row in local test",
      });
      continue;
    }

    const restored = await rowById(restoredClient, spec.table, spec.fields, source.row.id);
    const sourceNorm = normalizeRow(source.row);
    const restoredNorm = normalizeRow(restored);
    const same = JSON.stringify(sourceNorm) === JSON.stringify(restoredNorm);
    results.push({
      sample: spec.label,
      table: spec.table,
      id: source.row.id,
      status: same ? "PASS" : "FAIL",
      detail: same ? "critical fields match" : "critical fields differ or restored row is missing",
    });
  }
  return results;
}

export function integrityStatus(results) {
  return results.every((row) => row.status === "PASS") ? "INTEGRITY_PASSED" : "INTEGRITY_FAILED";
}

export function finalVerdict(parity, integrity) {
  return parity === "PARITY_PASSED" && integrity === "INTEGRITY_PASSED"
    ? "RECOVERY_CERTIFIED"
    : "RECOVERY_FAILED";
}

export function recordDrill(client, args) {
  return client.rpc("record_recovery_drill", {
    p_branch_id: args.branchId ?? BRANCH_A,
    p_environment: args.environment ?? "LOCAL",
    p_drill_type: args.drillType ?? "TEST",
    p_backup_created_at: args.backupCreatedAt ?? new Date().toISOString(),
    p_source_row_count: args.sourceRowCount ?? 0,
    p_notes: args.notes ?? null,
  });
}

export function recordArtifact(client, drillId, args) {
  return client.rpc("record_recovery_artifact", {
    p_recovery_drill_id: drillId,
    p_artifact_type: args.artifactType,
    p_artifact_name: args.artifactName,
    p_artifact_checksum: args.artifactChecksum,
    p_artifact_metadata: args.artifactMetadata ?? {},
  });
}

export function completeDrill(client, drillId, args) {
  return client.rpc("complete_recovery_drill", {
    p_recovery_drill_id: drillId,
    p_restore_completed_at: args.restoreCompletedAt ?? new Date().toISOString(),
    p_restored_row_count: args.restoredRowCount ?? 0,
    p_parity_status: args.parityStatus,
    p_integrity_status: args.integrityStatus,
    p_overall_verdict: args.overallVerdict,
    p_notes: args.notes ?? null,
  });
}

export function checkFactory() {
  let failures = 0;
  return {
    check(name, condition, detail = "") {
      if (condition) console.log(`  PASS ${name}`);
      else {
        failures += 1;
        console.error(`  FAIL ${name} ${detail}`);
      }
    },
    failures() {
      return failures;
    },
  };
}
