import { readFileSync } from "node:fs";

const checks = [];

function source(path) {
  return readFileSync(path, "utf8");
}

function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

const escalation = source("src/app/actions/operator/escalation.ts");
const action = source("src/app/actions/operator/drafts.ts");
const hook = source("src/app/operator/_components/operator-draft.tsx");
const stock = source("src/app/operator/_components/operator-stock-flow.tsx");
const waste = source("src/app/operator/_components/operator-waste-flow.tsx");
const stockPage = source("src/app/operator/stock/page.tsx");
const wastePage = source("src/app/operator/waste/page.tsx");
const e2e = source("tests/e2e/operator-draft-resume.spec.ts");
const completionMigration = source("supabase/migrations/202607142300_v18_operator_run_completion.sql");

check("draft writes return an explicit result", escalation.includes("Promise<OperatorRunSaveResult>"));
check(
  "late drafts cannot reopen terminal runs",
  escalation.includes('existing.data.status === "completed"') &&
    escalation.includes('existing.data.status === "abandoned"') &&
    !escalation.includes('.in("status", ["in_progress", "abandoned"])') &&
    escalation.includes('.eq("status", "in_progress")'),
);
check(
  "every existing-run mutation is branch, operator and workflow scoped",
  (escalation.match(/\.eq\("workflow", input\.workflow\)/g) ?? []).length >= 7 &&
    escalation.includes('.eq("branch_id", input.branchId)') &&
    escalation.includes('.eq("operator_id", input.profileId)'),
);
check("draft action resolves authenticated branch context", action.includes('resolveStaffContext("manager", { branchScoped: true })'));
check("draft payloads are bounded", action.includes("32_000"));
check("repeated failures reach the server log", action.includes("repeated save failures") && action.includes("draft_failures"));
check(
  "start fresh observes the row it actually abandoned",
  action.includes('.select("status")') &&
    action.includes("if (!changed.data)") &&
    action.includes('current.data?.status === "completed"'),
);
check(
  "completed and abandoned runs are terminal in PostgreSQL",
  completionMigration.includes("enforce_operator_run_terminal_v18") &&
    completionMigration.includes("OLD.status IN ('completed', 'abandoned')"),
);
check(
  "delivery and waste completion share their business transaction with the run fence",
  completionMigration.includes("record_operator_delivery_v18") &&
    completionMigration.includes("record_operator_waste_v18") &&
    completionMigration.includes("finalize_operator_run_v18"),
);
check("saves are debounced", hook.includes("SAVE_DEBOUNCE_MS"));
check("saves are serial and awaited", hook.includes("queueRef.current = queueRef.current.catch(() => undefined).then(async ()") && hook.includes("await saveOperatorDraft"));
check("a rejected network save leaves the retry queue usable", hook.includes("Network failures can reject") && hook.includes('"save-failed"'));
check("failure wording never blocks the real sale", hook.includes("OperatorDraftStatus"));
check("stock flow persists and resumes", stock.includes("useOperatorDraftSave") && stock.includes("OperatorDraftPrompt"));
check("waste flow persists and resumes", waste.includes("useOperatorDraftSave") && waste.includes("OperatorDraftPrompt"));
check("entry pages load same-day drafts", stockPage.includes("getLatestOperatorDraft") && wastePage.includes("getLatestOperatorDraft"));
check("refresh-mid-delivery journey exists", e2e.includes("resumes from the last saved step after refresh"));
check("start-fresh abandonment journey exists", e2e.includes("abandons the old run"));
check("failure remains non-blocking and retries", e2e.includes("never blocks the waste record") && e2e.includes("Not saved for resume"));

const failed = checks.filter((entry) => !entry.ok);
if (failed.length) {
  console.error(`\nOperator draft verification FAILED (${failed.length}/${checks.length}).`);
  process.exit(1);
}

console.log(`\nOperator draft verification PASSED (${checks.length} checks).`);
