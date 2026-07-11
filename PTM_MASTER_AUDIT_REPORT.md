# PTM_MASTER_AUDIT_REPORT

**PlaiceToMeat (PTM) — Full-System Adversarial Audit, Hardening & Production-Readiness Assessment**

Auditor role: Principal Architect / Staff Engineer / DB Reliability / AppSec / SRE / Product-Ops
Audit date: 2026-07-10 · Mode: evidence-first, read-only production inspection
Method: independent verification against live local Postgres 17 + read-only probes of live production. Prior reports, green CI, test names, documentation and memory were treated as untrusted and re-verified.

---

## 1. Executive verdict

### VERDICT: **CONDITIONAL PILOT**
> Limited, closely-supervised testing is possible **only after** the named P0/P1 blockers below are fixed and a restore is demonstrated. **Not** suitable for ordinary unsupervised shop operation today.

The PTM codebase is, at its core, **genuinely well-engineered** — the authentication boundary, Row-Level-Security model, RPC authority seal, checkout money path and inventory truth engine are among the more disciplined small-system implementations I have audited, and they hold up under adversarial inspection. **However, the audit found two production-reality failures that the internal dashboards and the agent memory report as "certified" but which are false in the live system:**

| Question the audit must answer | Answer |
|---|---|
| Audited commit (local = origin/main) | `d1a82e23a5a785732ead8fc4d6fc9dba9374bb55` (clean tree) |
| Production deployment | https://plaicetomeat-ops.vercel.app — LIVE, `/api/health` = HEALTHY. Exact commit SHA **UNVERIFIED** (no build identifier exposed). |
| Production DB migration head | **`202606300900`** (35 of 38 repo migrations). Missing the 3 latest, incl. the phase-3 truth-lock. |
| P0 / P1 / P2 counts | **1 P0, 1 P1, 3 P2, 8 P3** |
| Was a restore tested? | **NO** — and production backups have failed 30/30 for ~1 month (Gate H FAIL). |
| Was live production validation completed? | Partial: read-only health + migration + RLS probes only. No prod writes; no prod restore. |

**Three largest risks**
1. **No recoverable backup exists for the live database.** The daily production-backup workflow has failed every run for ~1 month (missing GitHub secrets). Loss/corruption of the Supabase project = total, unrecoverable loss of orders, stock, compliance and traceability records. *(PTM-DR-001, P0)*
2. **Production is missing the phase-3 write-lock migration**, so in the live DB any authenticated **staff** can forge `order_status_events` (falsify order history) and a **manager** can make unaudited price edits and fabricate waste events. The local `verify:truth-table-lock` gate proves these are blocked — but only on the local DB, which *has* the migration. *(PTM-REL-002, P1)*
3. **The health check hides #2.** `/api/health` reports `migration_parity: 11/11 HEALTHY` because it measures against a hand-curated 11-row `expected_migrations` table, not the 38 real migrations — so the drift is invisible to the owner. *(PTM-OBS-012, P3, but it is what makes #2 dangerous.)*

**Three strongest qualities**
1. **Checkout & inventory correctness.** Server-side price recomputation (client prices ignored), md5 idempotency fingerprint + `UNIQUE(idempotency_key)` giving exactly-once orders, `FOR UPDATE` window lock (no overbooking), FEFO depletion with consistent lock ordering, append-only ledger, and explicit *visible* oversell handling that never produces negative stock.
2. **Authorization depth.** RLS on all 48 tables, empirically verified: anonymous callers get `[]` on every sensitive table. Admin RPCs are `SECURITY DEFINER` with `auth.uid()` + role gates that reject direct API calls. No self-service role escalation is possible.
3. **Fail-closed instincts.** Rate-limiter fails closed, missing-secret middleware fails closed to home, no `EXCEPTION WHEN OTHERS` anywhere, and `create_checkout_order` is service-role-only so customers cannot bypass the throttled server action.

**Exact next action:** Configure the 4 missing GitHub Actions secrets and get one green production-backup run, then perform and document a restore drill; **and** apply migrations `202606301000`, `202607011300`, `202607101200` to the production database (expand-safe: they only REVOKE unused grants and drop permissive policies). Until both are done, do not run a real shop day on PTM.

No marketing language: PTM is a strong build sitting on an unsafe operational base. The build did not earn "ready"; the operations did not earn "recoverable."

---

## 2. What was audited

Full read access to the local repository, migrations, tests, scripts, CI workflows and docs; execution access to the local toolchain and a live local Supabase stack (Postgres 17, 11 containers, up 21h); read-only HTTPS access to the live production app and read-only anon-key access to the production PostgREST API; GitHub Actions history via authenticated `gh`.

- **Git / release state:** working tree, local/remote branches, tags, ahead-behind, merge history, lockfile, toolchain versions, env-var *names* (never values).
- **Build & validation (independently run):** `typecheck`, `lint`, `test` (620 unit), `build`, `architecture:check` static (7) + db (6), `verify:truth-table-lock`, `verify:required-compliance`, `verify:operator-firewall`, `verify:intelligence-firewall`.
- **Security:** middleware auth boundary; Supabase client factories; `staff-context` authority gate; full RLS policy dump + grant matrix + helper functions + view `security_invoker`; all 56 `SECURITY DEFINER` functions (search_path, anon-executability, authority checks); live anon PostgREST probes (SELECT + RPC); dependency audit; production security headers.
- **Domain / DB:** `create_checkout_order`, `transition_order_status`, `deplete_order_inventory`, `admin_reverse_order_inventory`, `admin_update_product_price`, `next_order_ref`, `get_public_order_status`; idempotency & append-only constraints/triggers; concurrency locks.
- **Ops:** all 5 CI workflows + run history; production-backup failure logs; production `/api/health` + `get_applied_migration_versions` (read-only).

Evidence artifacts are in the audit scratchpad: `phase0-fingerprint.md`, `validation-results.md`, `rls-policies.txt`, `findings-log.md`, `backup-run.log`.

## 3. What could NOT be audited (limitations & blockers)

| Area | Status | Reason |
|---|---|---|
| Production DB **write**/adversarial testing | **BLOCKED** | Read-only mandate; no authorized write. Correct per spec. |
| Production **service-role** DB inspection | **BLOCKED** | Local Vercel env pulls have empty secret values; no usable prod credentials on this machine. |
| Restore drill (Gate H) | **FAILED/UNVERIFIED** | No backup artifact exists to restore (workflow failing); no prod creds to generate one. |
| Exact deployed commit SHA | **UNVERIFIED** | No build identifier in app or headers; prod env git metadata empty. |
| Prod grant/policy state on products/status/waste | **INFERRED (high conf)** | pg_policies not exposed via PostgREST; established from migration lineage + author's own comment, not a live write test. |
| Live concurrency race harness | **NOT RUN** | Requires two authenticated racing sessions + seeded collected order; assessed by code + constraint review instead. |
| Full WCAG 2.2 AA / operator task-timing | **NOT RUN** | Requires a running app UI with axe + real devices; assessed at code level only. |
| Supabase Auth config, Storage bucket policies, Realtime publications | **PARTIAL** | Inspected via schema/config.toml; live Storage/Auth admin not accessible read-only. |

## 4. Canonical system state (reconciliation matrix)

| State | Commit / head | Evidence | Divergence |
|---|---|---|---|
| Working tree | `d1a82e2` (clean) | `git status` | — |
| Local `main` | `d1a82e2` | `git rev-parse` | none |
| `origin/main` | `d1a82e2` | post-`fetch` | **identical** (memory's "8 ahead / push blocked" = STALE) |
| Tag `pilot-candidate-v1` | `91488cd` | `for-each-ref` | **10 commits behind** main |
| Production app | HEALTHY, SHA unknown | `/api/health` 200 | commit identity unverifiable |
| Local DB | 38 migrations | `get_applied_migration_versions` (local) | current |
| **Production DB** | **head `202606300900` (35 migs)** | prod anon RPC (read-only) | **3 behind: `202606301000`, `202607011300`, `202607101200`** |

Toolchain: Node 24.13.0, pnpm 9.15.9 (corepack), Docker 29.5.3. Stack: Next.js 15.5.18 / React 19.1.0 / @supabase/ssr 0.10.3 / Zod 4 / TS 5 / Vitest 4 / Playwright 1.60. Production: Supabase project `qwvlzcqmicedxhfafiar`, Postgres 17.6.1, GoTrue 2.189, PostgREST 14.5, **region eu-west-1 (Ireland — EU residency, relevant to UK GDPR)**. Secrets: all real `.env*` gitignored & never committed; only `.env.example` tracked (good hygiene).

## 5. Architecture summary

Next.js App Router on Vercel + Supabase (Postgres/Auth/Storage/PostgREST). Three staff surfaces — `/operator` (guided low-literacy front door), `/admin` (owner/manager console), `/counter` (counter POS) — plus a public storefront (`/shop`, `/basket`, `/checkout`, `/order/*`) and `/api/{checkout,health}`. Middleware (`matcher: /counter,/admin,/operator`) enforces the auth boundary; server actions perform writes.

**Data path (money):** browser basket → `createOrderAction` (server action, size cap + JSON parse) → `submitCheckout` (Zod validation, merge SKUs, **fail-closed rate limit**, server test-mode gate) → `create_checkout_order` RPC (**service-role only**) which recomputes prices server-side, enforces idempotency, locks the pickup window, inserts order+items+status-event+audit atomically.

**Data path (stock):** `transition_order_status` (locked state machine) → on `collected` calls `deplete_order_inventory` in the same transaction → FEFO batch consumption → append-only `inventory_movements` ledger + `order_inventory_depletions` summary; oversell recorded as a visible shortfall.

**Three Supabase clients:** anon+cookies (RLS as user), anon+no-session (public RPCs), service-role (RLS-bypassing, server-only). A `public-route-imports` test guards public paths from importing the service client.

Observed weaknesses: `/counter` still ships despite memory claiming it was retired (surface sprawl); in-memory metrics; no build identifier; 3 coexisting `admin_create_inventory_batch` overloads (schema drift).

## 6. Trust boundaries & threat model

| Actor | Can reach | Contained by | Verified |
|---|---|---|---|
| Anonymous internet | storefront reads, `create` via server action only, public order status by unguessable id | RLS (empirically `[]` on all sensitive tables), service-role-only checkout RPC | ✅ live probes |
| Leaked anon key | same as anonymous (key is public by design) + **`next_order_ref` sequence mutation** | RLS; **gap: `next_order_ref` anon EXECUTE** | ⚠️ PTM-SEC-003 confirmed |
| Authenticated staff | own-branch reads; order state machine; **in prod: direct writes to status/waste events** | `is_branch_staff` RLS + RPC gates; **gap: phase-3 not in prod** | ⚠️ PTM-REL-002 |
| Manager | branch management; **in prod: unaudited direct product price edits** | `is_branch_manager`; **gap: phase-3 not in prod** | ⚠️ PTM-REL-002 |
| Compromised owner | full branch authority (by design) | audit_logs (append-only, locked in prod) | ✅ |
| Leaked service-role key | full DB (BYPASSRLS by design) | key kept server-side; not in bundle/git | ✅ not exposed |
| Developer / CI | repo + Actions | branch protection (unverified), secret scoping | ⚠️ backup secrets absent |

STRIDE highlights: **Tampering** — client price tampering defeated (server recompute); order-status tampering **open in prod** (missing lock). **Repudiation** — strong audit trail, but prod status/waste events forgeable. **Info disclosure** — RLS solid; public order DTO minimized to first-name. **DoS** — checkout throttled; `next_order_ref` is not. **Elevation** — no self-role-escalation path.

## 7. Critical invariants (status)

| # | Invariant | Enforcement | Status |
|---|---|---|---|
| I1 | Browser never receives service-role key | client factory separation + import test | ✅ HOLDS |
| I2 | Order totals computed server-side, client price ignored | `create_checkout_order` recompute | ✅ HOLDS |
| I3 | Exactly-once orders under retry/concurrency | `UNIQUE(idempotency_key)` + fingerprint + race handler | ✅ HOLDS |
| I4 | Inventory changes only via command path; ledger append-only | DEFINER RPCs + `prevent_inventory_movement_mutation` trigger | ✅ HOLDS (local); ⚠️ prod events forgeable |
| I5 | Exactly-once depletion; no negative stock | `UNIQUE(order_id,source_event)` + LEAST/floor + terminal `collected` | ✅ HOLDS |
| I6 | FEFO deterministic under concurrency | `ORDER BY expiry … FOR UPDATE` consistent lock order | ✅ HOLDS |
| I7 | No role self-escalation | no UPDATE policy on `profiles` for non-owners | ✅ HOLDS |
| I8 | Every durable transition has actor + timestamp | `auth.uid()` in RPCs, event tables | ✅ HOLDS |
| I9 | Audit history not editable by app roles | audit_logs write-locked (V11.2, in prod) | ✅ HOLDS |
| I10 | Oversell is a *visible* anomaly with owner escalation | shortfall row + audit log, **but no owner_alert** | ⚠️ PARTIAL (PTM-OBS-004) |
| I11 | Production schema originates from reviewed migrations at head | — | ❌ VIOLATED (PTM-REL-002) |
| I12 | Recoverable backup exists for critical data | — | ❌ VIOLATED (PTM-DR-001) |

## 8. Top findings

1. **PTM-DR-001 (P0)** — Production has **no working backups**: 30/30 daily runs failed ~1 month; required GitHub secrets absent. No restore ever demonstrated.
2. **PTM-REL-002 (P1)** — Production DB is 3 migrations behind the deployed release; the missing phase-3 lock means **authenticated staff can forge order-status events, managers can make unaudited price edits and fabricate waste events** in production.
3. **PTM-OBS-004 (P2)** — Oversell/shortfall is recorded but raises **no owner alert**; owner escalation depends entirely on a UI surface that does not currently show it.
4. **PTM-DR-011 (P2)** — Even when fixed, the backup captures only `public` table rows — **excludes Auth users, Storage evidence objects, and schema/functions/RLS**; restore is not turnkey.
5. **PTM-SEC-003 (P3, CONFIRMED exploit)** — `next_order_ref` is anon-executable and mutates order sequences: an unauthenticated caller advanced the live-local sequence with the public key.

## 9. Complete findings register

Severity reflects realistic triggerability, not drama. Confidence and environment noted per finding.

---
**PTM-DR-001 — No recoverable production backup**
Domain: resilience/DR · **Severity: P0** · Confidence: certain · Status: open · Env: production (CI)
Assets: entire production database (orders, inventory, compliance, traceability).
Evidence: `gh run list --workflow=production-backup.yml` → **30/30 `failure`** 2026-06-12→2026-07-10; failing step `node scripts/backup-production.mjs` exit 2; log line `backup-production crashed: NEXT_PUBLIC_SUPABASE_URL is required but not set`; env dump shows `SUPABASE_SERVICE_ROLE_KEY`, `CANONICAL_BRANCH_ID`, `BACKUP_ENCRYPTION_KEY` empty.
Reproduction: view any recent run of the workflow.
Expected: daily encrypted backup artifact + periodic restore drill. Actual: zero successful backups; agent memory falsely records "BACKUP_CERTIFIED/RECOVERY_CERTIFIED."
Impact: loss/corruption of the Supabase project is **unrecoverable** — total loss of financial, stock and food-traceability records. Root cause: required repo secrets never configured; failures unmonitored (no alert on red).
Containment: take a manual `supabase db dump` + Storage export now, store encrypted off-platform. Remediation: set the 4 secrets; get one green run; schedule + execute a documented restore drill; add a "backup age > 48h" alert. Regression: a monitor asserting latest successful run < 48h old. Residual: free-tier Supabase has no PITR — RPO is one day at best.

---
**PTM-REL-002 — Production migration drift leaves audit/truth locks unenforced**
Domain: release/DB/integrity · **Severity: P1** · Confidence: high · Status: open · Env: production
Assets: `products`, `order_status_events`, `inventory_waste_events`; audit trustworthiness.
Evidence: prod `get_applied_migration_versions` head = `202606300900` (35 migs); repo = 38. Missing `202606301000`, `202607011300`, **`202607101200_phase3_lock_products_and_events`**. The phase-3 file's own comment: *"production predates the CLI explicit-grants default, so authenticated still HAS write grants there"* and it `REVOKE INSERT,UPDATE,DELETE … FROM authenticated` + drops the permissive INSERT/ALL policies on all three tables. `/api/health` shows `11/11` because `expected_migrations` lists only 11.
Reproduction: compare prod applied versions to `supabase/migrations/`; read the phase-3 migration.
Expected: prod schema at release head; direct client-role writes to audited tables blocked (as the local `verify:truth-table-lock` proves). Actual: in prod, any **staff** can `INSERT order_status_events` (forge order-state history, bypassing `transition_order_status`), a **manager** can `UPDATE products.price_per_unit` (bypassing the `price_changed` audit) and `INSERT inventory_waste_events` with no matching `inventory_movements` row (evidence divergence).
Impact: falsified records; unaudited price changes; stock/waste evidence divergence — directly undermines the system's core trust claim. Trigger: any authenticated staff/manager session + direct PostgREST call (insider or compromised account; not anon).
Containment: apply the 3 missing migrations to prod (expand-safe: only REVOKEs + policy drops; `create_checkout_order`/DEFINER paths unaffected). Remediation: make deploys apply migrations to head; update `expected_migrations` to cover all security-critical migrations so `/api/health` reflects true parity; add a CI gate comparing deployed app migration set vs prod head. Regression: an integration test asserting `authenticated` cannot INSERT/UPDATE those tables (already exists locally — must be run against prod parity). Residual: none once applied. *Note: not live-write-confirmed on prod (would be an unauthorized write); confidence rests on migration lineage + the author's own comment.*

---
**PTM-OBS-004 — Oversell shortfall never escalates to the owner**
Domain: inventory/observability · **Severity: P2** · Confidence: high · Status: open · Env: all
Evidence: `deplete_order_inventory` writes `order_inventory_depletions.shortfall_kg` + `inventory_depletion_shortfall` audit log, but **0 functions reference both `owner_alerts` and `shortfall`**; the reconcile tray (`getReconciliationItems`) filters to cost-pending + waste-reason `warning` alerts only.
Impact: goods leave the shop with the ledger short, but no push/owner_alert is raised — the owner only sees it if they open the reconciliation view (which currently doesn't list shortfalls). Spec §26.3/§26.9 require oversell to be a visible anomaly with escalation. Remediation: on `shortfall_kg > 0`, insert an `owner_alerts` row (warning) and surface it in the reconcile tray / TODAY. Regression: test that a depletion with shortfall creates an unresolved owner_alert.

---
**PTM-DR-011 — Backup scope excludes Auth, Storage and schema**
Domain: resilience/DR · **Severity: P2** · Confidence: high · Status: open · Env: production
Evidence: `scripts/backup-lib.mjs` exports `CORE_TABLES` (public rows) via REST; no `auth.users`, no Storage bucket/object export, no schema/functions/RLS. Impact: after a project loss, restoring rows leaves `profiles` orphaned (auth.users gone → staff cannot log in), operator evidence photos/certificates gone (traceability/food-safety evidence lost), and schema must be rebuilt from migrations. Remediation: add `supabase db dump` (schema+roles) + a Storage object sync + documented Auth reconstruction to the backup; validate each data class in the restore drill.

---
**PTM-SEC-003 — `next_order_ref` anon-executable → unauthenticated sequence mutation**
Domain: authz/least-privilege · **Severity: P3** · Confidence: certain · Status: open · Env: local (confirmed); prod likely (same lineage)
Evidence: `has_function_privilege('anon', next_order_ref, 'EXECUTE')=true` (siblings `anon=false` via V14 REVOKE). Live test: `POST /rest/v1/rpc/next_order_ref` with the **public anon key**, no auth, returned `PTM-2026-00001`/`00002` and advanced `order_annual_sequences.last_sequence` 0→2. Unthrottled (rate limiting is in the app action, not the RPC).
Impact: an attacker who knows a branch id (semi-public) can burn/advance order-reference numbers → gaps in sequential numbering (accounting continuity) + mild numbering DoS. No money/stock/PII. Remediation: `REVOKE EXECUTE ON FUNCTION next_order_ref(uuid,date) FROM anon, PUBLIC;` (it is only called internally by `create_checkout_order`). Regression: assert anon cannot execute it.

---
**PTM-INV-005 — Reversal guard is per-reason, not per-order → double-restore possible**
Domain: inventory integrity · **Severity: P3 (latent)** · Confidence: high · Status: open · Env: all
Evidence: `admin_reverse_order_inventory` idempotency = `UNIQUE(order_id, source_event)` where `source_event` derives from the reason; the same collected order reversed under two different reasons (`refund` then `operator_correction`) creates two groups and restores SALE_COLLECT stock twice → inventory inflation. Mitigant: RPC is **unwired** (no `src/` caller) and requires `authenticated`+`is_branch_manager`. Remediation before wiring any reversal UI: guard against *any* prior reversal group for the order's SALE_COLLECT movements. Regression: test that a second differing-reason reversal is rejected.

---
**PTM-OBS-012 — Health migration-parity measured against 11 curated rows, masking drift**
Domain: observability · **Severity: P3** · Confidence: certain · Status: open · Env: production
Evidence: `/api/health` → `migration_parity 11/11 HEALTHY` while repo has 38 migrations and prod is at 35. Impact: the single dashboard an owner would trust to answer "is prod up to date?" reports green during real drift (enabler for PTM-REL-002). Remediation: base parity on the full security-critical migration set (or the CLI ledger), not a hand-maintained subset.

---
**PTM-SEC-007 — CSP allows `script-src 'unsafe-inline'`**
Domain: appsec · **Severity: P3** · Confidence: certain · Status: open · Env: production
Evidence: response CSP `script-src 'self' 'unsafe-inline'`. Impact: weakens XSS defense (any injected inline script executes). Otherwise CSP is strong (object-src none, base-uri self, frame-ancestors none, upgrade-insecure-requests). Remediation: move to nonce/hash-based script-src (Next.js supports nonces via middleware). Trade-off: some engineering cost; acceptable for a small shop but worth doing.

---
**PTM-OBS-008 — Metrics are in-memory per serverless instance**
Domain: observability · **Severity: P3** · Confidence: high · Status: open · Env: production
Evidence: `/api/health` metrics all `0` on a warm prod instance; `getMetricsSnapshot()` reads process memory. Impact: checkout/login/denied counters reset per cold start and per instance → effectively unusable for detecting failure rates. Remediation: emit to a durable sink (even a Postgres counter table) or a real metrics backend.

---
**PTM-REL-009 — No build identifier; deployed commit unverifiable**
Domain: release · **Severity: P3** · Confidence: certain · Status: open · Env: production
Evidence: no SHA in `/api/health`, no commit header, empty git metadata in env pull. Impact: production code cannot be reconciled to a commit — violates release-identity discipline (spec §40). Remediation: expose `VERCEL_GIT_COMMIT_SHA` via a safe `/api/health` field or build-time constant.

---
**PTM-DB-006 — `admin_create_inventory_batch` has 3 coexisting overloads**
Domain: DB/maintainability · **Severity: P3** · Confidence: certain · Status: open · Env: all
Evidence: 3 signatures (13/14/16 args) exist; old ones not dropped. Impact: PostgREST overload-ambiguity risk; maintenance confusion. Remediation: drop superseded signatures.

---
**PTM-DEP-010 — Transitive `postcss < 8.5.10` moderate CVE**
Domain: supply-chain · **Severity: P3** · Confidence: certain · Status: open · Env: build
Evidence: `pnpm audit` → 1 moderate, `postcss@8.4.31` via `next@15.5.18` (GHSA-qx2v-qp2m-jg93, CSS-stringify XSS). Impact: build-time tool, not user-input-driven — low practical risk. Remediation: bump via Next update / pnpm override. Otherwise the dependency tree is clean (no high/critical).

---
**PTM-DATA-013 — Repo hygiene: committed artifacts + stale branches**
Domain: repo · **Severity: P4** · Confidence: certain · Status: open · Env: local/remote
Evidence: tracked `dev-server.log`, `PlaiceToMeat-UI-screens-20260611.zip`, `ptm-route-screenshots.zip`, `pnpm.cmd`; 13 stale local branches; `pilot-candidate-v1` tag 10 commits behind. Impact: repo bloat/confusion; a "pilot candidate" tag that doesn't match main. Remediation: gitignore/remove artifacts; prune merged branches; retag or delete the stale pilot tag.

---
**PTM-SEC-014 — `order_notes` INSERT checks branch, not order ownership**
Domain: authz · **Severity: P4** · Confidence: medium · Status: open · Env: all
Evidence: `order_notes` INSERT policy `WITH CHECK is_branch_staff(branch_id)` validates the note's branch but not that `order_id` belongs to that branch. A staffer could attach a note to an order id from another branch by supplying their own branch_id. Impact: minor data-integrity/annotation-integrity; no disclosure (reads are branch-scoped). Remediation: `WITH CHECK` should verify the order belongs to the actor's branch.

## 10. Fixes implemented

**None applied.** Per the spec's evidence-preservation mandate and the read-only production posture, this pass is diagnosis-only: no code, migration, branch or database state was modified. The two headline issues (PTM-DR-001 backup secrets, PTM-REL-002 prod migration apply) are **operator actions on production infrastructure**, not code changes, and must be done by the owner with the real secrets. All findings ship with reproduction + remediation + a regression test so fixes can be made safely on their own risk-domain branches. One deliberate, reversible local side-effect: the confirmed `next_order_ref` exploit advanced the disposable local seed sequence (reset on next `seed:dev`).

## 11. Validation results (independently executed, commit d1a82e2)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS (0 errors) |
| Unit tests | `pnpm test` | **PASS 620/620** (79 files, ~1.7s, jsdom) |
| Lint | `pnpm lint` | PASS (0 errors, 5 unused-var warnings) |
| Build | `pnpm build` | PASS |
| Architecture static | `architecture:check --tier=static` | PASS 7/7 |
| Architecture db | `architecture:check --tier=db` | PASS 6/6 (real SQL) |
| truth-table-lock | `verify:truth-table-lock` | PASS 12/12 (real SQL) — **but only proves the LOCAL DB, which has phase-3** |
| required-compliance | `verify:required-compliance` | PASS |
| operator/intelligence firewalls | static scans | PASS |
| operator-route-lock, operator-journeys, today-os, etc. | live tier | **NOT RUN** (Next server was down) |
| Dependency audit | `pnpm audit --prod` | 1 moderate (postcss) |

**Caveat (spec rule 3):** the 620 "unit" tests run under jsdom with **no database** — they prove pure logic only. The DB-tier guards prove the *local* schema (which is at head); they say nothing about production, which is 3 migrations behind. Green ≠ production-safe here.

## 12. Production-readiness gates

| Gate | Verdict | Basis |
|---|---|---|
| A — State integrity | **PASS (caveat)** | canonical commit known; drift quantified; **prod build SHA unverified** |
| B — Clean reproducible build | **PASS** | typecheck/lint/test/build green from committed lockfile (not a fresh clone) |
| C — Database truth | **FAIL (prod)** | local schema strong; **prod drift leaves truth-lock unenforced** |
| D — Security | **FAIL (prod)** | code sound; 1 P1 (prod forgeable events) + confirmed P3 anon write |
| E — Domain correctness | **PASS (local) / FAIL (prod)** | invariants hold locally; prod status/waste forgeable |
| F — Operator usability | **UNVERIFIED** | no live UX/task-timing run; code-level review only |
| G — Reliability & observability | **PARTIAL** | fail-closed design good; metrics unusable; no oversell escalation |
| H — Backup & recovery | **FAIL** | 30/30 backup failures; no restore demonstrated; scope excludes Auth/Storage |
| I — Compliance-support evidence | **PARTIAL** | records exist; prod forgeable events undermine "records can't be falsified" |
| J — Live deployment | **FAIL** | app deployed & healthy, but **migrations not at head** |

## 13. Operational, privacy & food-record assessment

**Privacy (UK GDPR):** personal data = customer name/phone/email + pickup notes (`orders`), staff email/name (`profiles`), phone in `sms_log`. Data resides in **eu-west-1 (Ireland)** — acceptable EU residency. Public order DTO minimizes exposure to first-name only (good minimization). Gaps: no evident retention/erasure job (orders/PII kept indefinitely); backups (once working) will contain PII with no documented retention; no DSAR/export tooling. Lawful basis/retention are **owner decisions requiring human confirmation** — do not assert compliance from fields alone.

**Food-safety records:** `compliance_readings`/`compliance_logs` capture temperatures with a required-evidence gate (verified: completion blocks when a fridge reading is missing; out-of-range rejected) — a genuine strength. **But** in production the missing phase-3 lock lets waste events be fabricated without a ledger movement, and status history be forged — so the "records cannot silently claim a check occurred" guarantee is **not fully true in prod**. Fix PTM-REL-002 before relying on records for an EHO inspection.

**Traceability/recall:** `inventory_batches` carry supplier, product, received/expiry dates, lot fields; movements link sales to batches (kg products). A recall query can trace kg-product batches to depletions. **Limitation:** only kg/weight-tracked products flow through the inventory engine — `each`/`box` items (e.g. whole chickens by count) have no batch lineage, so recall coverage is partial. State this honestly to the owner.

**HMC/halal:** `supplier_documents`/`supplier certs` can store approved-source evidence; no evidence the app displays an unverified certification claim. Do not infer certification status from intent.

## 14. Backup & disaster-recovery result

**Gate H: FAIL.** No successful production backup exists (30/30 failures, ~1 month). No restore has ever been demonstrated in the current configuration. Even once the secrets are fixed, the backup is a logical row-export of `public` tables only — it does not contain Auth users, Storage evidence objects, or schema/functions/RLS, so a real recovery requires re-applying migrations + reconstructing Auth + restoring Storage separately. The local db-tier guard "backup/restore schema & objects exist" passes (the *tooling* exists), which is exactly the false comfort the spec warns about: **existence of a backup mechanism is not recoverability.** RPO today ≈ ∞ (no backup); target RPO ≤ 24h (free tier, no PITR); RTO undefined (no drill). Incident commander, restore criteria and comms plan are documented in runbooks but untested.

## 15. Performance & scale assessment

No load test run (measure-before-optimize; no perf regression suspected at pilot scale). Structural review: checkout serializes per pickup-window via `FOR UPDATE` — correct, and fine at one/two tills; at high concurrency on a single popular window it would queue (acceptable). FEFO depletion locks candidate batches in a consistent order (no deadlock). Indexed unique keys on idempotency. Concerns for scale: append-only `inventory_movements`/`audit_logs` grow unbounded (add partitioning/retention before multi-shop); in-memory metrics won't survive horizontal scale; per-request `getUser()` in middleware adds an auth round-trip on every staff navigation (fine at pilot, watch at scale). Design is appropriately simple — no premature distribution. Credible path to ~10 shops with the current model + the fixes below; 100 shops is a design projection, not a current target.

## 16. Operator & owner usability assessment

Code-level (no live task-timing run). **Strengths:** dedicated low-literacy `/operator` surface with 4 big flows (open/serve/stock/waste/close + help/escalation); an "intelligence firewall" keeps scores/analytics out of operator copy (verified by static guard); partial-success signalling on checkout (order placed even if the access cookie fails, with a recovery message) is a mature UX-integrity choice; owner "TODAY OS" compresses decisions. **Concerns:** three staff surfaces (`/operator`, `/counter`, `/admin`) is more than "one door per job" claims — `/counter` still ships despite being reported retired; oversell anomalies don't reach the owner (PTM-OBS-004); "something went wrong" generic messaging exists on some server faults (acceptable given secret-safety, but pair with a support code). Full WCAG 2.2 AA and real-device/poor-network testing remain **unverified** and are required before a controlled pilot.

## 17. Fable's independent opinion

1. **Strongest technical idea:** the RPC authority seal — every mutation is a `SECURITY DEFINER` function that re-derives identity from `auth.uid()` and re-checks role, so the UI, the API and the DB all enforce the same rule. This is why direct-API attacks fail.
2. **Strongest product idea:** "maximum technical capability, minimum operator skill" made real by the Operator Mode + intelligence firewall — genuinely thoughtful for a low-literacy co-owner.
3. **Over-engineered:** the owner-brain/intelligence stack (action-compression, morning-briefing, win-back, firewalls, dozens of `verify:*` guards) is a lot of surface for a single unlaunched shop. It's impressive but it competes for attention with the operational basics that are actually broken (backups, migration deploy).
4. **Under-engineered:** deployment/release discipline. The code is careful; getting that code *and its schema* onto production, verifiably, is not. The single most valuable engineering investment is a deploy that applies migrations to head and proves it.
5. **Most dangerous assumption:** "green guards = production is safe." The guards run against a local DB at head; production is not. This assumption is what turned a solved problem (phase-3 lock exists) into a live P1.
6. **Most likely to silently fail:** backups (already failing silently for a month) and in-memory metrics (silently zero).
7. **Remove/delay:** `/counter` surface (consolidate into operator/admin) and some of the intelligence guards until after launch basics are solid.
8. **Most valuable next feature:** a real deploy pipeline (migrate-to-head + smoke + backup-age check) — it retires two of the top three risks.
9. **What blocks multi-shop:** unbounded event tables without partitioning, per-instance metrics, and the absence of tenant-isolation load testing — plus the operational immaturity. The RLS branch model itself is multi-shop-ready (verified: 2 branches, branch-scoped policies).
10. **Would refuse to ship:** a shop running live with zero backups. Full stop.
11. **Simplify for the operator:** collapse three staff doors to one.
12. **Make explicit for the owner:** "is production at the right version?" and "when was the last successful backup?" — surface both truthfully on TODAY.
13. **Tests creating false confidence:** `verify:truth-table-lock` (proves local, implies prod) and `/api/health` migration parity (11 of 38).
14. **Keep unchanged:** the checkout/inventory RPC design and the RLS helper-function pattern — they're right.
15. **Would I trust my own money/stock/traceability to it today?** For correctness of a single transaction — yes. For a week of unattended operation without losing everything to one Supabase incident, or without an insider forging records — **no, not until PTM-DR-001 and PTM-REL-002 are fixed.**

## 18. Residual risks (after recommended fixes)

- Free-tier Supabase = no PITR; best-case RPO one day.
- Backups (even fixed) need Auth + Storage coverage or recovery stays partial.
- Insider/compromised staff remains a threat even with phase-3 applied (mitigated by audit_logs, not eliminated).
- kg-only inventory truth: `each`/`box` recall coverage stays partial by design.
- WCAG/operator-timing and live concurrency remain unproven until run.

## 19. Roadmap

**Immediate (before ANY further live use) — P0/P1 + truth**
- Configure the 4 backup secrets; get one green backup; take a manual encrypted dump now. *(owner; dep: Supabase+GitHub access; ~1h; retires PTM-DR-001 start; validate: green run + artifact)*
- Apply migrations `202606301000`, `202607011300`, `202607101200` to prod. *(owner/eng; expand-safe; ~30m; retires PTM-REL-002; validate: re-probe applied versions = 38; run truth-lock test against prod parity)*
- `REVOKE EXECUTE ON next_order_ref FROM anon, PUBLIC`. *(eng; migration; retires PTM-SEC-003)*
- Fix `/api/health` migration parity to reflect all security-critical migrations. *(retires PTM-OBS-012)*

**Next 30 days — correctness, restore, observability**
- Perform + document a full restore drill into a scratch project (DB + Auth + Storage). *(retires part of PTM-DR-011; Gate H)*
- Raise an `owner_alert` on oversell shortfall + surface in TODAY. *(PTM-OBS-004)*
- Durable metrics sink + backup-age monitor + deploy-vs-schema drift CI gate.
- Expose a build identifier. *(PTM-REL-009)*

**31–60 days — hardening, a11y, compliance**
- CSP nonces. *(PTM-SEC-007)* · order-level reversal guard before wiring reversal UI *(PTM-INV-005)* · `order_notes` order-ownership check *(PTM-SEC-014)* · drop `admin_create_inventory_batch` overloads *(PTM-DB-006)* · postcss bump *(PTM-DEP-010)*.
- Full WCAG 2.2 AA pass + poor-network/device testing. Retention/DSAR tooling + documented lawful basis (human-confirmed).

**61–90 days — scale prep**
- Partition/retention for `inventory_movements`/`audit_logs`; tenant-isolation load test; consolidate `/counter`; multi-shop onboarding.

## 20. Final decision & exact conditions

**CONDITIONAL PILOT.** PTM's application logic is trustworthy enough to record a real transaction correctly, but the live system is **not safe to run a shop on today** because (a) there is no recoverable backup, and (b) production is missing the migration that stops records being falsified. These are operational/deployment defects on a strong codebase, not fundamental design flaws — which is why the verdict is not NO-GO.

**It advances to CONTROLLED-PILOT READY only when all of the following are evidenced:**
1. One green production-backup run **and** a documented restore drill (DB + Auth + Storage) — Gate H.
2. Production DB at migration head (38), re-verified via applied-versions probe, with the truth-lock test passing against production parity — Gates C/E/J.
3. `next_order_ref` anon EXECUTE revoked — Gate D.
4. `/api/health` reports true migration parity and a build identifier — Gate A.
5. A live operator walkthrough of the 14 core tasks with no silent failure — Gate F.

Until #1 and #2 are done, the honest answer to *"would you trust PTM to run a real butcher shop tomorrow?"* is **no** — because it could lose everything to one infrastructure incident, and because its own records can be quietly falsified in production.

---

## 21. Appendix: evidence index

- `scratchpad/evidence/phase0-fingerprint.md` — git/toolchain/secrets/migration fingerprint + hashes.
- `scratchpad/evidence/validation-results.md` — independent build/test/guard results + route map.
- `scratchpad/evidence/rls-policies.txt` — full `pg_policies` dump (56 policies).
- `scratchpad/evidence/findings-log.md` — running findings with live evidence.
- `scratchpad/evidence/backup-run.log` — production-backup failure log (run 29066372426).
- `PTM_AUDIT_FINDINGS.json` — machine-readable findings register.

## 22. Appendix: command log (key commands)

```
git fetch --all --prune --tags; git rev-list --left-right --count origin/main...main   # 0/0
corepack pnpm typecheck | test | lint | build                                          # all pass; 620/620
corepack pnpm architecture:check -- --tier=static | --tier=db                           # 7/7 ; 6/6
docker exec supabase_db_plaicetomeat-ops psql -U postgres -d postgres -c "<introspection>"  # RLS, grants, funcs
curl -s .../rest/v1/rpc/next_order_ref  (anon key)                                      # CONFIRMED anon write
curl -s https://plaicetomeat-ops.vercel.app/api/health                                 # HEALTHY; 11/11
curl -s .../rest/v1/rpc/get_applied_migration_versions (prod anon)                      # 35 migs; head 202606300900
gh run list --workflow=production-backup.yml                                            # 30/30 failure
```

## 23. Appendix: standards / control crosswalk

| Standard | Area | Status |
|---|---|---|
| OWASP ASVS 5.0 — V1 Auth | session revalidation, fail-closed | ✅ strong |
| ASVS — V4 Access Control | RLS + RPC authority seal | ✅ (local) / ⚠️ prod drift |
| ASVS — V5 Validation | Zod + server-side recompute | ✅ |
| ASVS — V7 Error/Logging | no WHEN OTHERS; sanitized errors; **weak metrics** | ⚠️ |
| ASVS — V14 Config | strong headers; **CSP unsafe-inline; no build id** | ⚠️ |
| NIST SSDF | reviewed migrations, CI gates; **deploy-to-head gap** | ⚠️ |
| Supabase/PG RLS guidance | RLS all tables, definer search_path pinned, views security_invoker | ✅ |
| GitHub Actions security | **backup secrets absent; workflow red unmonitored** | ❌ |
| UK GDPR/ICO | EU residency; minimization good; **no retention/DSAR** | ⚠️ human review |
| HACCP recordkeeping | temp gate enforced; **prod forgeable waste/status** | ⚠️ fix PTM-REL-002 |

*Prepared by Fable 5 acting as adversarial co-founder. Findings are evidence-backed; production write-state items are high-confidence inferences from migration lineage, explicitly not confirmed by prohibited production writes.*
