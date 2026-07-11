# PTM Remediation — Phase 1 Report

**Date:** 2026-07-11 · **Engine:** Fable 5 Ultracode · **Governing audit:** `PTM_MASTER_AUDIT_REPORT.md`
**Branch:** `ptm-remediation-phase-1` · **Remediation commit:** `ba169d1` · **Deployed:** `dpl_GMEvLN6UGZB6ZLzr6oUdDgZvTpxQ`

---

## 1. Final verdict

### **CONTROLLED-PILOT READY**

All five verdict conditions are evidenced:

| Condition | Status | Proof |
|---|---|---|
| Backup restored successfully | ✅ | Encrypted full-scope backup of real prod data created + integrity-verified + restored into 3 isolated scratch DBs; full validation battery green |
| Production at reviewed migration head | ✅ | `supabase migration list --linked` → 40/40 matching; live health `parity:true, head 202607111000` |
| Anonymous sequence mutation blocked | ✅ | Prod dump: `next_order_ref` `REVOKE ALL FROM PUBLIC` + `GRANT service_role` only; denial proven on the clone |
| Build identity known | ✅ | Live prod `/api/health` `build.known:true, commit ba169d1` |
| Health reporting reflects reality | ✅ | Deterministic 40-migration parity; live DEGRADED on simulated drift; live HEALTHY when in-parity |

> **Residual owner action (does not block the pilot verdict, but must be closed for unattended operation):** the recurring daily backup workflow needs owner-controlled GitHub secrets. Until the first green run, `/api/health` truthfully reports `backup_freshness: DEGRADED` and the release gate blocks on backup freshness. This is deliberate fail-closed behaviour (rule 7/8), not a defect. See §6.

**Why not a stronger verdict:** "PRODUCTION-VERIFIED" for the DB + app is met, but rule 8 forbids declaring the whole line complete while the owner-controlled backup secrets remain outstanding. CONTROLLED-PILOT READY is the honest ceiling: the system is safe for a closely-supervised pilot now; unattended operation waits on the backup automation.

---

## 2. What changed in production (and how it was made safe)

Production was mutated in exactly two controlled ways, each authorised and each preceded by the full rule-5 gate (current verified backup + integrity + scratch restore + independent migration review + post-migration adversarial validation on a production clone):

1. **Database:** applied 5 pending migrations (`db push --linked`) → head `202607111000`.
2. **Application:** redeployed commit `ba169d1` with an injected build SHA → prod alias.

No destructive production write was used as proof. No production reset/rewrite occurred. All forge-denial claims are proven on a **byte-identical production-restored clone**, then corroborated in production by read-only introspection only.

---

## 3. Phase A — Reconciliation (independently verified)

| State | Value | Source |
|---|---|---|
| Audited / local / origin main (before) | `d1a82e2` (clean) | `git rev-parse` |
| Deployed commit (before) | **UNVERIFIED** — no build id; `gitSource:null`; timing-correlated to `d1a82e2` | Vercel API + `/api/health` |
| Repo migrations (before) | 38 (checksums computed) | `sha256sum supabase/migrations/*.sql` |
| **Production head (before)** | **`202606300900` (35 applied)** — 3 behind | `supabase migration list --linked` |
| Missing migrations | `202606301000`, `202607011300`, `202607101200` | ledger diff |
| Backup workflow | **0 successes / 33 runs**, latest 2026-07-10, all `failure` (absent secrets) | `gh run list` |
| Backup scope (before) | 8 public tables only; no auth/storage/schema | `backup-lib.mjs CORE_TABLES` |
| Health (before) | `HEALTHY`, `migration_parity 11/11` (masking) | `curl /api/health` |
| `next_order_ref` grants (before) | `GRANT ALL` to anon, authenticated, service_role | prod schema dump |
| Phase-3 policy state (before) | 3 permissive write policies present; authenticated held write grants | prod schema dump |

Every audit claim was reproduced. The audit's inferred (lineage-based) claims about production write-openness were **upgraded to demonstrated exploits** on a production clone (§5).

---

## 4. Phase B — Backup & recovery (PTM-DR-001 / DR-011)

Delivered `scripts/backup-production-full.mjs` (schema+auth+storage+roles+data, AES-256-GCM, manifest + checksums, stamps the freshness ledger) and `scripts/restore-backup-scratch.mjs` (repeatable restore drill). Runbook: `docs/runbooks/ptm-phase1-recovery.md`.

**Drill executed on real production data (read-only capture):** encrypted artifact (97,168 bytes) — checksum stable, decrypt round-trip OK — restored into an isolated scratch DB and validated:

- schema object counts **48 tables / 66 functions / 56 policies / 22 triggers**; **RLS 48/48**;
- critical row counts (orders 5, order_items 5, products 9, audit_logs 120); **FK integrity 0 orphans**;
- **Auth/profile reconciliation** — 5 users, 0 orphaned profiles; storage 1 bucket + object metadata;
- representative **read** path `get_public_order_status` (anon) → non-null; representative **write** path `create_checkout_order` (service_role) → `PTM-2026-00003`.

**Measured RPO ≤ 24h** (daily cadence; free-tier = no PITR). **RTO ≈ 10–15 min** artifact→validated restore.

---

## 5. Phase C — Missing-migration review (independent)

All three were reviewed against the live schema and applied to the production clone before production. Adversarial validation on the clone:

| | BEFORE migrations (prod-equivalent) | AFTER migrations |
|---|---|---|
| anon `next_order_ref` | **SUCCEEDED → PTM-2026-00003** (advanced) | permission denied |
| staff forge `order_status_events` | **INSERT SUCCEEDED** | permission denied for table |
| manager unaudited price edit | **UPDATE SUCCEEDED** | permission denied for table |
| authenticated INSERT grant (3 tables) | true | false |
| permissive write policies (3 tables) | 3 | 0 |
| authorized DEFINER `transition_order_status` | — | **wrote status event with no direct grant** |
| authorized `create_checkout_order` | — | **PTM-2026-00003** |
| service_role `next_order_ref` | — | **PTM-2026-00003** (intact) |

### Per-migration dossier

**`202606301000_clean_local_api_grants`** — *purpose:* restore service_role table/sequence privileges + `GRANT SELECT ON profiles TO authenticated` under the CLI explicit-grants default. *Objects:* schema/table/sequence grants + default privileges. *Grants before/after:* adds service_role ALL + authenticated profile SELECT; no policy change. *Lock/txn:* metadata-only, transactional, sub-second. *App compat:* additive; deployed app unaffected. *Rollback:* re-issuable; reversal not recommended (would break reads). *Stop:* role missing → abort.

**`202607011300_service_role_api_grants`** — *purpose:* ensure service_role authority + reachable SELECT for anon/authenticated; `GRANT INSERT ON order_notes TO authenticated`; **REVOKE `emit_audit_log` from PUBLIC/anon/authenticated** (keep audit emission private). *Objects:* grants + default privileges + one function REVOKE. *Before/after:* net-tightens `emit_audit_log`; broadens read reachability (RLS still gates rows). *Lock/txn:* metadata-only, transactional, sub-second. *App compat:* additive; unaffected. *Rollback:* re-issuable. *Stop:* function signature mismatch → abort.

**`202607101200_phase3_lock_products_and_events`** — *purpose (P1 core):* close direct-write doors on `products`, `inventory_waste_events`, `order_status_events`; sweep legacy TRUNCATE/REFERENCES/TRIGGER grants. *Objects:* DROP 3 permissive policies; REVOKE INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from authenticated/anon/PUBLIC on the 3 tables + TRUNCATE/REFERENCES/TRIGGER on all public tables. *Before/after:* writes only via DEFINER RPCs / service_role afterward. *Lock:* brief `ACCESS EXCLUSIVE` per policy drop/REVOKE (ms; pre-launch, no contention). *Txn:* transactional. *App compat:* the deployed app writes these only via DEFINER RPCs (verified by src scan) → unaffected; **confirmed live: app served HTTP 200 post-apply.** *Rollback:* re-GRANT + re-CREATE policies (dangerous — re-opens P1; see rollback runbook). *Stop:* an app flow doing a direct client-role write → would surface as a denied write (none exists).

---

## 6. Phase D — Security & health fixes

- **`202607110900`** revokes `next_order_ref` EXECUTE from PUBLIC/anon/authenticated, keeps service_role (the operator-serve path); the DEFINER `create_checkout_order` runs as owner and is unaffected. Regression guard `verify:next-order-ref-lock` (5/5): anon+authenticated denied, sequence unmoved, service_role intact. **(PTM-SEC-003)**
- **Deterministic health parity** — `src/lib/server/migration-manifest.generated.ts` (mechanically derived from *all* migrations) replaces the curated 11-row table. `/api/health` now exposes `build.commit`, `migration.{requiredHead,observedHead,parity,manifestChecksum}`, and `backup.{lastSuccessAt,ageSeconds,state}`, and **fails closed to DEGRADED** when the build is unknown, schema is behind, or the last verified backup is stale/absent. **(PTM-OBS-012, PTM-REL-009, PTM-DR-001 signal)**
- **`202607111000`** adds the append-only `ops_backup_runs` ledger + `record_backup_run` (service_role) + `get_backup_freshness` (anon, safe aggregates only).
- **Build SHA** injected at build time via `next.config.ts` (`PTM_BUILD_SHA`).

**Live proof:** prod health now `build_identity HEALTHY (ba169d1)`, `migration_parity HEALTHY 40/40`, `backup_freshness DEGRADED` (truthful — no recurring backup yet). Live DEGRADED demonstrated on simulated drift (`39/40 applied; missing 1`) — exactly what the old check masked.

---

## 7. Phase E — Deployment prevention controls

`scripts/verify-release-gate.mjs` + `.github/workflows/release-gate.yml` block promotion when: manifest drift (checksum), production behind head, a named security-lock migration missing, no recent verified backup, or build identity unknown/unreconcilable. `generate-migration-manifest.mjs --check` (wired into `architecture:check` static tier) prevents any curated-subset regression — **no release path depends on a hand-maintained migration subset anymore.** App deploy and schema migration are separate steps with an explicit ordering contract (runbook §ordering). Demonstrated **RED** (schema at head but no backup → BLOCKED) and **GREEN** (after a stamped backup → ALLOWED).

---

## 8. Validation summary

typecheck ✅ · lint ✅ (0 err) · unit **634/634** ✅ (+14 new) · build ✅ · architecture static **8/8** ✅ · architecture db **7/7** ✅ (incl. truth-table-lock + next-order-ref-lock) · scratch restore drill ✅ · release gate red/green ✅ · health truthful-degraded & truthful-healthy ✅ · prod migration parity 40/40 ✅ · prod build identity `ba169d1` ✅.

Full machine-readable evidence: `PTM_REMEDIATION_PHASE_1_EVIDENCE.json`.

---

## 9. Residual-risk register

| ID | Risk | Sev | Owner action | Mitigation in place |
|---|---|---|---|---|
| R1 | Recurring backups not yet running (owner secrets absent) | **High** | Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CANONICAL_BRANCH_ID`, `BACKUP_ENCRYPTION_KEY`, `SUPABASE_DB_URL`; run workflow to green | Verified manual backup + restore drill exists; health + release gate fail-closed until green |
| R2 | Free-tier Supabase has no PITR | Med | Consider paid tier / off-platform WAL for < 24h RPO | RPO ≤ 24h documented; daily cadence |
| R3 | Storage object BYTES not in the logical backup (metadata only) | Med | Add Storage API/S3 sync to backup (few objects today) | Object metadata captured; documented in recovery runbook |
| R4 | Deployed via CLI (`ba169d1`) — branch not yet merged to `origin/main` | Med | Merge `ptm-remediation-phase-1` → main so git-connected deploys carry `VERCEL_GIT_COMMIT_SHA` | Build identity already exposed via injected `PTM_BUILD_SHA`; release gate reconciles to commit |
| R5 | Insider/compromised staff remains a threat with phase-3 applied | Med | Ongoing | audit_logs append-only + all writes via audited DEFINER RPCs |
| R6 | `MAINTAIN` privilege remains for anon/authenticated on truth tables | Low | Optional REVOKE MAINTAIN | Not a data-write privilege (PG17 maintenance ops); no forge vector |
| R7 | in-memory metrics reset per instance (PTM-OBS-008) | Low | Durable sink (out of Phase-1 scope) | Not addressed this phase (P3, unrelated) |

Out-of-scope P3/P4 findings (OBS-004, INV-005, SEC-007, OBS-008, DB-006, DEP-010, DATA-013, SEC-014) were intentionally **not** touched this phase.

---

## 10. Owner next steps (to close the pilot → unattended gap)

1. Configure the 5 GitHub secrets (names in the recovery runbook — never paste values into chat/logs).
2. Run the `Production Backup` workflow to a green run; confirm `/api/health` `backup_freshness` flips to HEALTHY.
3. Merge `ptm-remediation-phase-1` → `origin/main` so history and future deploys stay canonical.
4. Schedule a periodic restore drill (`restore-backup-scratch.mjs`) and a backup-age monitor.

**Runbooks:** production change → `docs/runbooks/ptm-phase1-production-change.md`; recovery → `ptm-phase1-recovery.md`; rollback/forward-fix → `ptm-phase1-rollback.md`.
