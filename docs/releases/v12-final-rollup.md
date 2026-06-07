# V12 Final Rollup

Date: 2026-06-07
Branch: `v12.4-audit-coverage`
Companion: `docs/releases/v12-launch-certification.md`

## 1. Executive Summary

V12 took PlaiceToMeat from "works" to "trustworthy and operable". It is a
hardening + finalisation programme, not a feature programme: no new
customer-facing features, no redesigns, no speculative architecture.

The programme sealed the authority model (RPC, identity, branch), made checkout
and inventory concurrency-safe and tamper-resistant, gave the audit log
non-forgeable security-event coverage, replaced silent demo fallbacks with honest
operational-truth states, and finished with the operational layer needed to run in
production: observability (V12.8), production-readiness controls (V12.9), and this
launch certification (V12.10).

State: code-complete, locally certified, all in-repo gates green. Production-only
validation steps remain (secrets, prod migration push/parity, live HTTP checks,
backup drill) before go-live.

## 2. Commits

| Commit | Phase | Title |
|---|---|---|
| `63d98a7` | V12.0 | chore: establish v12 reproducible foundation |
| `2466ae8` | V12.1 | fix: seal v12 rpc authority |
| `39428c1` | V12.2 | fix: seal v12 identity and branch authority |
| `c349bcc` | V12.3 | fix: harden checkout integrity and concurrency controls |
| `12e205d` | V12.4 | feat: add v12 security audit coverage |
| `0e75f32` | V12.5 | fix: add v12 inventory stale-write protection |
| `a1abf51` | V12.6 | fix: harden v12 checklist evidence integrity |
| `8cc195a` | V12.7 | fix: add v12 operational truth states |
| `cd38bd0` | V12.5-7 | docs: add v12.5-v12.7 rollup |
| `113514b` | V12.8 | feat: add v12 observability foundation |
| `03769c5` | V12.9 | docs: add v12 production readiness controls |
| _(this)_ | V12.10 | docs: certify v12 launch readiness |

## 3. Migrations

23 SQL migrations total; four added by V12:

| Version | Phase | File |
|---|---|---|
| 202606061200 | V12.1 | `v12_1_rpc_authority_seal.sql` |
| 202606071000 | V12.3 | `v12_3_checkout_integrity.sql` |
| 202606071600 | V12.5 | `v12_5_inventory_stale_count_guard.sql` |
| 202606071700 | V12.6 | `v12_6_checklist_evidence_integrity.sql` |

V12.2, V12.4, V12.7, V12.8 are migration-free by design.

## 4. Verification Scripts

| Script | Proves |
|---|---|
| `verify-public-access` | public boundary; anon RPC denial (V12.1) |
| `verify-audit-authenticity` | audit log non-forgeable (V11.2/V12.1) |
| `verify-audit-coverage` | security events emit, PII-free (V12.4) |
| `verify-checkout-integrity` | price authority, capacity, idempotency (V12.3) |
| `verify-inventory-integrity` | atomic, non-negative, stale-count CAS (V12.5) |
| `verify-checklist-integrity` | checklist evidence integrity (V12.6) |
| `verify-ops-capture` | ops-capture data path |
| `verify-operational-truth` | honest data-truth states (V12.7) |
| `verify-health` | runtime health + checkout readiness (V12.8) |
| `verify-production-readiness` | secrets, hygiene, migration parity (V12.9) |
| `check-migrations` / `audit-bundle` | release drift / sanitised review bundle |

Full-gate result (2026-06-07, local): all PASS — see
`docs/releases/v12-launch-certification.md` for the evidence table.
Headline: tsc PASS, eslint PASS (4 pre-existing warnings), 364 unit tests PASS,
next build PASS, all listed verify scripts PASS, audit:bundle secret scan CLEAN.

## 5. Remaining Risks

1. Manual inventory expected-value guard — no expected-vs-entered check at manual
   remaining-weight adjustment time.
2. Signed adjustment ledger semantics — append-only but not per-row signed;
   tamper-evidence relies on DB authority.
3. Observability provider deferral — in-process counters reset on cold start;
   durable forwarding + production alert provider deferred;
   `checkout_partial_success` defined but unwired; some loaders still use ad-hoc
   `console.*`.
4. Production-only validations not yet executed — strict secret check, prod
   migration push + parity, live HTTP health/checkout suites, backup/restore drill.
5. Local dev `schema_migrations` recording artifact (V12.1 unrecorded locally) —
   dev-only, no production impact.

## 6. Production Prerequisites

Before go-live, complete `docs/releases/release-readiness-checklist.md`, in
particular:

1. Set production secrets in Vercel: `SUPABASE_SERVICE_ROLE_KEY`,
   `ORDER_ACCESS_SECRET` (>=32), `STAFF_SESSION_SECRET` (or valid fallback),
   `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`, `CANONICAL_BRANCH_ID`.
2. Confirm hygiene flags off: `ALLOW_DEMO_DATA`, `CHECKOUT_TEST_MODE_ENABLED`,
   `NEXT_PUBLIC_CHECKOUT_TEST_MODE`.
3. `supabase db push` so all repo migrations (incl. V12.5/V12.6) are applied to the
   production DB; confirm `check-migrations` parity is clean.
4. `PRODUCTION_READINESS_MODE=strict node scripts/verify-production-readiness.mjs`
   against the production env — must PASS.
5. `GET /api/health` on production returns `HEALTHY`; run `verify-health` and
   `verify-checkout-integrity` with `HEALTH_BASE_URL`/`CHECKOUT_BASE_URL` set.
6. Confirm Supabase backups enabled and perform a restore drill into a throwaway
   project (`docs/runbooks/`).

## 7. Launch Recommendation

**GO for production, conditional** on the §6 prerequisites being executed and
signed off. The codebase is hardened, observable, and operable; all in-repo
verification is green. Deferred items (§5 risks 1-3) are accepted, non-blocking
follow-ups. Await operator approval before deploying.
