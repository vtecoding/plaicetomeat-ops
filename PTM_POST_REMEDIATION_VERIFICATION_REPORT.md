# PTM — Post-Remediation Release Verification Report

**Date:** 2026-07-11 · **Mode:** independent verification (claims treated as unproven) · **Posture:** read-only against production; no destructive tests; no fixes applied.
**Question:** has PTM legitimately advanced from `CONTROLLED-PILOT READY` to `UNATTENDED-PILOT READY`?

> **Closeout addendum (post-verification, owner-authorised).** After this verification, the owner authorised the release closeout. Completed since:
> - **State divergence RESOLVED (V2/V3):** `ptm-remediation-phase-1` fast-forward-merged and pushed → `origin/main`; production redeployed **from canonical main**; `/api/health` build reconciles to a main commit. The release gate is now on main (active). Deploy-from-main can no longer silently revert the protections.
> - **PTM-OBS-004 fixed (V-OBS-004):** migration `202607111100` raises a `warning` `inventory_shortfall` owner_alert on oversell (surfaces via Owner Away); regression guard `verify:shortfall-owner-alert` added (db tier 8/8). Scratch-restore-validated on a fresh prod backup, then applied to prod (head **41/41**, `202607111100`), redeployed.
> - **`verify-checkout-integrity.mjs` fixed:** the HTTP-section `PRODUCT_PRICE` ReferenceError → `truth.price`; the script now completes and reports honestly (all checks pass on a correctly-bound server).
> - **Current canonical state:** local = main = `origin/main` = deployed = **`900db21`**; prod schema **41/41** head `202607111100`.
>
> **The verdict below is UNCHANGED: CONTROLLED-PILOT READY, not UNATTENDED.** The remaining blocker is unchanged — **recurring backup automation is still not operational** (owner-held secrets, esp. `BACKUP_ENCRYPTION_KEY`, and a green scheduled run + artifact restore). The full browser-level operator walkthrough on real staff devices/weak-network also remains owner-side.

---

## 1. Verdict

### **CONTROLLED-PILOT READY (retained). NOT advanced to UNATTENDED-PILOT READY.**

**Binary recommendation — can PTM run a normal shop week without continuous engineering supervision? → NO.**

The Phase-1 remediation is real and the security substance holds in production: the DB is at the reviewed migration head, the truth-table forge doors are shut, `next_order_ref` is locked, and the health endpoint is now honest. Under **supervision**, the running system is safe. But two conditions required for **unattended** operation are objectively unmet, and neither is a matter of interpretation:

1. **No recurring backup exists.** The scheduled workflow has *never* succeeded (latest run 2026-07-11 03:10 UTC = `failure`); zero GitHub secrets are configured. There is no workflow-produced artifact to restore, so recoverability of *ongoing* data cannot be demonstrated.
2. **Production runs code that is absent from `origin/main`.** The deployed commit `ba169d1` and the entire remediation exist only on a local branch. `origin/main` is still the pre-remediation `d1a82e2` (38 migrations, old masking health route). Canonical states do **not** agree.

Either one alone blocks `UNATTENDED-PILOT READY`. It is **not** `BLOCKED`: the live security controls are intact and every operator command path works without silent failure, so a closely-supervised pilot remains appropriate.

---

## 2. Scorecard against the 7 UNATTENDED conditions

| # | Condition | Result | Evidence |
|---|---|---|---|
| 1 | origin/main, deployed commit, prod schema reconciled | ❌ FAIL | deployed `ba169d1` not on any remote; origin/main `d1a82e2` (38 migs) vs prod 40 |
| 2 | Scheduled recurring backup green | ❌ FAIL | 0 successes ever; latest 2026-07-11 03:10 UTC `failure`; `gh secret list` empty |
| 3 | A workflow-produced artifact restored | ❌ FAIL | no green run ⇒ no artifact exists (manual backup explicitly not accepted) |
| 4 | Health fully healthy + truthfully degrades | ⚠️ PARTIAL | truthful degrade/heal PROVEN; but prod state is currently `DEGRADED` (backup), so not "fully healthy" |
| 5 | All critical operator tasks pass without silent failure | ✅ PASS | command-path verification of all 14 flows (see §6) |
| 6 | No open P0 or P1 | ❌ FAIL | recurring-backup gap = open P0 for unattended operation (DR-001 not fully closed) |
| 7 | No unresolved state divergence | ❌ FAIL | deployed code absent from origin/main; origin/main lacks both new migrations + manifest + honest health route |

---

## 3. Reconciliation (independently verified)

| State | Observed | Agree? |
|---|---|---|
| Working-tree HEAD | `9451ea1` (branch `ptm-remediation-phase-1`) | — |
| local `main` | `d1a82e2` | — |
| `origin/main` | `d1a82e2` | — |
| remediation branch head | `9451ea1` (2 commits: `ba169d1`, `9451ea1`) | **not on origin** |
| deployed Vercel commit | `ba169d1` (`/api/health` build.commit; deploy `dpl_GMEvLN6UGZB6ZLzr6oUdDgZvTpxQ`, 17h old) | **absent from origin/main** |
| production DB migration head | `202607111000` (40/40 via `migration list --linked`) | matches branch repo, **not origin/main (38)** |
| generated migration manifest | in sync on branch (40, head 202607111000); **absent from origin/main** | divergent |
| backup ledger state | prod `get_backup_freshness` → `has_success:false` (health `lastSuccessAt:null`) | consistent (no backups) |
| latest Production Backup run | 2026-07-11 03:10 UTC **failure** (`NEXT_PUBLIC_SUPABASE_URL is required but not set`) | — |
| latest backup artifact age | **none** (0 successful runs ⇒ no artifact) | — |
| health endpoint | `state:DEGRADED`; build `ba169d1` known; parity 40/40; `backup_freshness:DEGRADED` | truthful |

**Critical divergence:** `origin/main` does not contain the remediation. The 2 new migrations (`202607110900`, `202607111000`), the migration manifest, the honest `/api/health` route, the release gate, and the full-backup workflow **exist only on the local branch and in the deployed build**. Today's *scheduled* backup ran from `origin/main` — i.e., the **old** backup script, not the enhanced one.

---

## 4. Backup automation verification — FAIL

| Requirement | Result |
|---|---|
| 5 GitHub secrets configured | ❌ `gh secret list` returns **empty** (0 configured) |
| Scheduled workflow succeeds | ❌ latest run `failure`; **0/33+** successes; crash `NEXT_PUBLIC_SUPABASE_URL is required but not set` |
| Encrypted artifact produced | ❌ no successful run ⇒ no artifact |
| Integrity verification succeeds | ❌ n/a (no artifact) |
| Scope incl. schema/data/policies/functions/grants/Auth/Storage | ⚠️ *tooling* exists on branch (`backup-production-full.mjs`) but is **not on the branch Actions schedules from**, so it never runs |
| Backup ledger records the run | ❌ prod ledger empty (`has_success:false`) |
| Health reports backup freshness accurately | ✅ correctly `DEGRADED` (fail-closed — the one honest signal here) |
| Scratch restore from **workflow-produced** artifact | ❌ **impossible** — no workflow artifact has ever been produced |

Per the mandate, the previously demonstrated *manual* backup/restore drill is **not** accepted as proof that recurring automation works. It does not.

---

## 5. Security & database verification — PASS (read-only)

| Claim | Result | Evidence |
|---|---|---|
| Prod migration parity == repo head | ✅ | `migration list --linked` 40/40, 0 pending, head `202607111000` |
| Migration manifest matches files | ✅ | `generate-migration-manifest --check` up to date (40) |
| Migration checksums match | ⚠️ partial | repo↔manifest checksums verified; prod exposes no per-file hash (version parity used) |
| anon cannot execute `next_order_ref` | ✅ | prod dump: `REVOKE ALL FROM PUBLIC` + `GRANT service_role` only; guard 5/5 on prod-equivalent (anon+authenticated denied, sequence unmoved) — **not executed against prod (would mutate)** |
| authenticated cannot mutate truth tables | ✅ | prod dump: 3 permissive policies dropped, tables `SELECT,MAINTAIN` only; `verify:truth-table-lock` 12/12 on prod-equivalent |
| authorized RPC paths usable | ✅ | `transition_order_status`, `admin_update_product_price` (audited), `create_checkout_order`, `next_order_ref` (service_role) all work |
| health degrades on invalidated parity | ✅ | isolated test: removed head from ledger → `migration_parity:DEGRADED`, overall DEGRADED → restored HEALTHY |
| health degrades on stale backup | ✅ | isolated test: aged success row >48h → `backup_freshness:DEGRADED` → restored HEALTHY |
| health healthy only when all hold | ✅ | baseline all-6-green only with parity + fresh backup + known build + config |

Production security posture was re-dumped read-only during this verification and is **unchanged/unreverted** since Phase 1.

---

## 6. Operator gate — PASS (command-path), UI-timing not captured

Verified on the production-equivalent local stack (migration head 40, identical security state). All flows exercised at the RPC/command-path level the operator UI invokes:

| # | Task | Result | Evidence / DB state | Silent failure? | Dup on retry? |
|---|---|---|---|---|---|
| 1 | Open shop | ✅ | `verify:ops-capture` PASS (checklist capture, idempotent) | no | no |
| 2 | Record required temperatures | ✅ | `compliance-integrity` + `required-compliance` PASS; direct staff INSERT DENIED; audit rows exist; completion blocked without reading | no | idempotent |
| 3 | Receive delivery | ✅ | `ops-capture` delivery/receive path PASS | no | idempotent |
| 4 | Create inventory batch | ✅ | batch insert via command path; used across guards | no | n/a |
| 5 | Serve cash order | ✅ | serve sequence (service_role): `next_order_ref`→order→items→status event = `PTM-2026-00015` | no | idempotent (`operator-serve:runId`) |
| 6 | Serve card order | ✅ | same path, `payment_method='card'` | no | idempotent |
| 7 | Retry checkout after interruption | ✅ | `checkout-integrity`: idempotent retry returns same ref, **exactly one** order row | no | **no** |
| 8 | Duplicate-submit checkout | ✅ | `checkout-integrity`: same key ⇒ one order; different payload rejected; concurrency ⇒ no overbooking | no | **no** |
| 9 | Collect order | ✅ | `transition→collected` fired depletion: batch 5→3kg, 1 SALE_COLLECT movement, status `collected` | no | exactly-once depletion |
| 10 | Handle inventory shortfall | ✅ | `inventory-integrity`: **negative stock impossible**, shortfall visible in ledger | no | idempotent |
| 11 | Record waste | ✅ | `ops-capture`: waste → `inventory_movements` | no | idempotent |
| 12 | Correct operator error via authorised path | ✅ | `truth-table-lock`: RPC corrections work + audited; direct client writes denied | no | idempotent |
| 13 | Close shop | ✅ | `ops-capture` close/apply PASS; applied lines immutable | no | idempotent |
| 14 | Escalate to owner | ✅ | `escalation.ts` (service_role) → `owner_alerts` (INSERT grant confirmed; authenticated denied) | no | — |

**Caveats (honest limitations):**
- These are **command-path** proofs (what the UI calls), not full browser-clicked UI runs. The `verify:operator-serve` Playwright harness did **not** complete in this environment (defaulted to the wrong port; UI-walkthrough seed/timing). I ruled out a product regression by executing the serve DB sequence directly (order created successfully). **Full live-UI operator task-timing and on-screen error copy were not captured** — carry from the audit's Gate F (still UNVERIFIED at the UI level).
- `verify-checkout-integrity.mjs` crashes in its **optional HTTP section** with `ReferenceError: PRODUCT_PRICE is not defined` (pre-existing script bug, unrelated to the product). All 15 DB-level adversarial checks passed before it.
- **PTM-OBS-004 (P2, from the audit) remains open:** an oversell shortfall is visible in the ledger but raises no `owner_alert`. Not a blocker, but relevant to unattended operation.

---

## 7. Release & rollback verification

| Check | Result | Evidence |
|---|---|---|
| Release gate fails for stale migration | ✅ | removed head from ledger → `production migration parity: FAIL` → BLOCKED |
| Release gate fails for stale backup | ✅ | aged success row → `recent verified backup exists: FAIL` → BLOCKED |
| Release gate fails for unknown build id | ✅ | no SHA in release mode → `build identity: FAIL` → BLOCKED |
| Release gate allows when all hold | ✅ | control run → PROMOTION ALLOWED |
| Rollback/forward-fix runbook executable | ✅ | all reversal SQL blocks ran cleanly in `BEGIN…ROLLBACK` (next_order_ref re-grant, phase-3 re-grant+policies, ledger drop) |
| Runbooks internally consistent | ✅ | reversal SQL mirrors the forward migrations exactly |
| **Deploy from main cannot silently revert protections** | ❌ **FAIL** | the release gate + honest health + manifest are **not on origin/main**; a deploy from main reverts the app-layer honest health (OBS-012) + build id (REL-009) and no gate on main would block it. (DB locks REL-002/SEC-003 persist in the DB and would survive.) |

The release gate **logic** is correct and fail-closed — but it is **inert**: it lives only on the branch, so it currently protects nothing.

---

## 8. Residual risk register

| ID | Risk | Severity (for unattended) | Status |
|---|---|---|---|
| V1 | No recurring backups (secrets absent; workflow red; no artifact ever produced) — a mid-week Supabase incident = catastrophic, unrecoverable loss beyond the last manual dump | **P0** | OPEN — owner must set 5 secrets + get a green run + restore that artifact |
| V2 | State divergence: production runs `ba169d1`, which exists only on the owner's local machine (not on origin/main). Loss of that machine ⇒ deployed prod code is unreproducible | **P1** | OPEN — merge branch → origin/main |
| V3 | Release gate + honest-health + manifest not on origin/main ⇒ inactive; a routine deploy from main silently reopens OBS-012 (health masking) + REL-009 (build id) | **P1** | OPEN — merge branch → origin/main; gate then runs on push |
| V4 | Health is `DEGRADED` in production right now (backup), so "fully healthy" is unmet for unattended | P2 | Follows from V1 |
| V5 | PTM-OBS-004 — oversell shortfall raises no owner alert | P2 | OPEN (out of Phase-1 scope) |
| V6 | Full live-UI operator task-timing / on-screen error behaviour not captured | P2 | UNVERIFIED (harness env) |
| V7 | `verify-checkout-integrity.mjs` HTTP section crashes (`PRODUCT_PRICE`) | P3 | OPEN (script bug) |
| V8 | Free-tier: no PITR (RPO ≤ 24h at best); Storage object bytes not in logical backup | P2 | Documented, carried from Phase 1 |

No open **P0/P1 exists in the running application's security or correctness** — those were genuinely retired. The open P0/P1s (V1–V3) are **operational/release-governance**: backup automation and code-provenance. That is precisely the boundary between "supervised pilot" and "unattended."

---

## 9. Exact path from here to UNATTENDED-PILOT READY

All owner-controlled; none require further engineering design (the code is done, on the branch):

1. **Merge `ptm-remediation-phase-1` → `origin/main`** and redeploy from main (or push to the deploy branch). Reconciles V2/V3; activates the release gate; `VERCEL_GIT_COMMIT_SHA` then reconciles automatically.
2. **Configure the 5 GitHub secrets** (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CANONICAL_BRANCH_ID`, `BACKUP_ENCRYPTION_KEY`, `SUPABASE_DB_URL`) and run the Production Backup workflow to **green**.
3. **Restore that workflow-produced artifact** into a scratch environment (`restore-backup-scratch.mjs`) and confirm the full validation battery.
4. Re-check `/api/health` → expect **fully HEALTHY** (backup_freshness flips) and re-run the release gate against production → expect ALLOW.

When all four are evidenced, conditions 1–4, 6 and 7 close and the verdict can advance. Until then: **CONTROLLED-PILOT READY — supervised operation only.**

---

## 10. Evidence appendix (key commands, this verification)

```
git fetch; git rev-parse origin/main            # d1a82e2 (38 migrations)
curl .../api/health                             # DEGRADED; build ba169d1; parity 40/40; backup DEGRADED
git branch -r --contains ba169d1                # (empty — not on origin)
gh secret list                                  # (empty)
gh run list --workflow=production-backup.yml    # latest 2026-07-11 failure; 0 successes
supabase migration list --linked                # 40/40, head 202607111000
supabase db dump --linked                       # next_order_ref service_role-only; 3 policies dropped
verify:truth-table-lock                         # 12/12 (prod-equivalent)
verify:next-order-ref-lock                      # 5/5
health degrade tests (isolated)                 # DEGRADED on parity + on stale backup; HEALTHY only all-green
verify:release-gate (A/B/C/D)                   # BLOCK on unknown-build / stale-backup / stale-migration; ALLOW on control
operator command paths                          # serve PTM-2026-00015; collect→deplete 5→3kg; checkout idempotent
```

*Independent verification by Fable 5. No production writes were used as proof. No fixes were applied.*
