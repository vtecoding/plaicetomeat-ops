import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.OPERATOR_CERTIFICATE_BASE_URL ?? "http://localhost:3004";
const PASSWORD = process.env.OPERATOR_PASSWORD ?? "PlaiceTest123!";

function loadLocalEnv() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // CI can provide env directly.
  }
}

loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase env missing.");

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lr9S2wAAAABJRU5ErkJggg==", "base64");
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

async function one(table, select, query) {
  let q = admin.from(table).select(select);
  q = query(q);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function login(page, email, target) {
  await page.goto(`${BASE_URL}/login?returnTo=${encodeURIComponent(target)}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await Promise.all([page.waitForURL(`**${target}`), page.getByRole("button", { name: "Sign in" }).click()]);
}

async function run() {
  const marker = new Date().toISOString();
  const filePath = join(tmpdir(), `ptm-certificate-${Date.now()}.png`);
  writeFileSync(filePath, png);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(25_000);
    await login(page, "operator@ptm.test", "/operator/certificate");
    await page.getByRole("button", { name: "Halal paper" }).click();
    await page.locator('input[type="file"]').setInputFiles(filePath);
    await page.getByRole("heading", { name: "Done" }).waitFor();
    await page.getByText("Saved. Owner will check it.").waitFor();

    const doc = await one("compliance_documents", "id,document_url,doc_type,status,created_at", (q) =>
      q.eq("doc_type", "halal").gt("created_at", marker).order("created_at", { ascending: false }).limit(1),
    );
    check("review row created", !!doc, doc?.id ?? "");
    check("review row needs owner", doc?.status === "needs_owner_review", doc?.status ?? "");
    check("review row points at evidence", typeof doc?.document_url === "string" && doc.document_url.startsWith("operator_evidence:"), doc?.document_url ?? "");

    const evidenceId = doc.document_url.replace("operator_evidence:", "");
    const item = await one("operator_evidence", "id,status,evidence_type,source_type,source_id,source_ref,object_path", (q) => q.eq("id", evidenceId));
    check("evidence row created", !!item, evidenceId);
    check("evidence is certificate", item?.evidence_type === "certificate", item?.evidence_type ?? "");
    check("evidence linked to review row", item?.source_type === "compliance_document" && item?.source_id === doc.id, `${item?.source_type}:${item?.source_id}`);
    check("evidence needs owner", item?.status === "needs_owner_review", item?.status ?? "");

    const signed = item?.object_path ? await admin.storage.from("operator-evidence").createSignedUrl(item.object_path, 60) : { data: null };
    check("stored photo opens", !!signed.data?.signedUrl);

    const alert = await one("owner_alerts", "id", (q) => q.eq("entity_ref", doc.id).is("resolved_at", null));
    check("owner alert created", !!alert, alert?.id ?? "");

    const audit = await one("audit_logs", "id", (q) =>
      q.eq("event_type", "ops_session_completed").eq("target_type", "operator_workflow_run").filter("metadata->>documentId", "eq", doc.id).limit(1),
    );
    check("operator audit written", !!audit, audit?.id ?? "");

    const owner = await browser.newPage();
    await login(owner, "owner@ptm.test", "/admin/evidence");
    await owner.getByText("Certificate").first().waitFor();
    await owner.getByText("Needs review").first().waitFor();
    check("owner can see it", true);
  } finally {
    await browser.close();
    rmSync(filePath, { force: true });
  }

  console.log("");
  console.log(`Operator certificate gate PASSED (${checks.length} checks)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
