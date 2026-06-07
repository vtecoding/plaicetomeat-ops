# V12 Launch Certification

Date: 2026-06-07
Status: CERTIFIED (local validation) — pending production-only steps and operator
approval.
Scope: evidence only. No architecture change. This document certifies the state of
the V12 programme (V12.0-V12.10) against its hardening and readiness objectives.

---

## Repository State

- Branch: `v12.4-audit-coverage` (carries the full V12.5-V12.10 lineage).
- Main branch for PRs: `main`.
- V12 commit lineage (oldest → newest):

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

- Migrations: 23 SQL files in `supabase/migrations/`. Four are V12:
  - `202606061200_v12_1_rpc_authority_seal.sql`
  - `202606071000_v12_3_checkout_integrity.sql`
  - `202606071600_v12_5_inventory_stale_count_guard.sql`
  - `202606071700_v12_6_checklist_evidence_integrity.sql`
  - (V12.2, V12.4, V12.7, V12.8 are migration-free by design.)

- Verification scripts (`scripts/verify-*.mjs`):
  `verify-public-access`, `verify-audit-authenticity`, `verify-audit-coverage`,
  `verify-checklist-integrity`, `verify-checkout-integrity`, `verify-health`,
  `verify-inventory-integrity`, `verify-operational-truth`, `verify-ops-capture`,
  `verify-production-readiness`, plus governance: `check-migrations`,
  `audit-bundle`, `release-report`.

---

## Security

### V12.1 — RPC Authority Seal
Mutation RPCs are service-role-only. `anon`/`authenticated` cannot call
`emit_audit_log`, `check_rate_limit`, or `create_checkout_order` directly.
Proven by `verify-public-access` and the anon-denial checks in
`verify-checkout-integrity` and `verify-audit-coverage`.

### V12.2 — Identity & Branch Authority
Single `requireStaffContext` path; signed, user-bound staff-session envelope with
idle + absolute timeouts; branch fallbacks removed (fail-closed); owner
revalidation; hardened login/logout; `/unauthorised`. Enforced in middleware and
server actions.

### V12.4 — Security Audit Coverage
`security_event` audit is live via `recordSecurityEvent` → hardened
`emit_audit_log` (service-role-only, allowlisted event types, size-capped,
secret-stripped). Emits for failed login, lockout, session
missing/expired/tampered/cross-user, role/branch/no-branch/owner denial,
unauthorised route, logout failure. PII-free (hashed identity/network signals).
Proven by `verify-audit-authenticity` and `verify-audit-coverage`.

---

## Checkout

### V12.3 — Checkout Integrity
Single hardened `submitCheckout` service shared by the storefront action and
`POST /api/checkout`: server price authority, duplicate-SKU merge with per-product
max enforcement, distinct-SKU cap, pickup-window capacity under concurrency (no
overbooking via `FOR UPDATE`), idempotency (one order per key; same-key/
different-payload rejected), throttle + 32 KiB body cap. Proven by
`verify-checkout-integrity` (HTTP suite optional/skipped without a running server).

---

## Inventory

### V12.5 — Inventory Concurrency Integrity
`FOR UPDATE` locks, atomic non-negative movements, append-only ledger, no
sale-decrement, and a SQL-side compare-and-set guard so a stale stock-count apply
cannot clobber intervening waste/adjustments (`STALE_STOCK_COUNT`). Proven by
`verify-inventory-integrity` and `verify-ops-capture`.

---

## Compliance

### V12.6 — Checklist Evidence Integrity
Opening/closing/stock-count checklist evidence is integrity-protected: evidence
payload validation, branch-scoped writes/completion, idempotent steps, and
completion-without-evidence refusal. Proven by `verify-checklist-integrity`.

---

## Operational Truth

### V12.7 — Operational Truth Layer
Typed `DataResult` states (`HEALTHY`/`NO_DATA`/`DEGRADED`/`UNAVAILABLE`/
`UNAUTHORISED`/`CONFIGURATION_REQUIRED`); production demo-fallback removed and
gated behind explicit `allowDemoFallback()`; canonical storefront branch required
in production; shared `OperationalSnapshotV1` for `/admin` and `/admin/today`;
honest UI truth banners. Proven by `verify-operational-truth`.

### V12.8 — Observability (this programme)
Structured logging (categories + severity + redaction), in-process operational
counters, explicit health states, `GET /api/health`, `verify-health` synthetic
check, and a vendor-neutral alert abstraction. Instrumented at the auth, checkout,
inventory, and audit chokepoints. Proven by the `observability` unit suite and
`verify-health`.

### V12.9 — Production Readiness (this programme)
`verify-production-readiness` (required secrets + hygiene + migration parity),
backup/restore runbooks, release-readiness checklist, `.env.example` completion.

---

## Full Certification Gate — Evidence (2026-06-07, local)

| Gate item | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx eslint` | PASS (4 pre-existing warnings) |
| `npx vitest run` | PASS — 364 tests / 50 files |
| `npx next build` | PASS (`/api/health` registered) |
| `node scripts/verify-public-access.mjs` | PASS |
| `node scripts/verify-audit-authenticity.mjs` | PASS |
| `node scripts/verify-ops-capture.mjs` | PASS |
| `node scripts/verify-checkout-integrity.mjs` | PASS (HTTP suite skipped — no app server) |
| `node scripts/verify-inventory-integrity.mjs` | PASS |
| `node scripts/verify-health.mjs` | PASS (HTTP suite skipped — no app server) |
| `node scripts/verify-production-readiness.mjs` | PASS (LOCAL mode — 7 production-only secrets skipped) |
| `node scripts/audit-bundle.mjs --dry-run` | PASS — secret scan CLEAN |

(Also green outside the spec's explicit list: `verify-audit-coverage`,
`verify-checklist-integrity`, `verify-operational-truth`.)

---

## Remaining Risks (known, deferred)

1. **Manual inventory expected-value guard** — the stale-count CAS (V12.5) protects
   the apply path, but a manual remaining-weight adjustment still trusts the
   operator's entered figure; there is no expected-vs-entered guard at manual
   adjustment time.
2. **Signed adjustment ledger semantics** — the inventory ledger is append-only
   but adjustment rows are not cryptographically signed; tamper-evidence relies on
   DB authority (RLS + service-role-only writes), not per-row signatures.
3. **Observability provider deferral** — metrics are in-process and reset on cold
   start; durable metric forwarding and a production alert provider (e.g. Sentry)
   are deferred. `checkout_partial_success` is defined but unwired (no create-time
   partial path today). Lower-risk intelligence loaders still use ad-hoc `console.*`.
4. **Production-only validations not yet executed**:
   - strict secret validation (`PRODUCTION_READINESS_MODE=strict`) against the
     production env;
   - migration parity against the production DB after `supabase db push`
     (V12.5/V12.6 migrations must be pushed);
   - HTTP-layer health/checkout suites against a running production app
     (`HEALTH_BASE_URL` / `CHECKOUT_BASE_URL`);
   - backup presence + quarterly restore drill (`docs/runbooks/`).
5. **Local dev migration recording artifact** — the local dev DB's
   `schema_migrations` is out of sync with the repo (V12.1 unrecorded locally);
   this is a dev-only artifact and does not affect production, where parity must be
   clean.

---

## Launch Recommendation

The V12 programme is **code-complete and locally certified**. All in-repo gates are
green and the security/checkout/inventory/compliance/operational-truth hardening is
proven by adversarial verification scripts.

Recommendation: **GO for production, conditional on the production-only steps in
Remaining Risks §4 being executed and signed off** using
`docs/releases/release-readiness-checklist.md`. The deferred items in §1-§3 are
accepted, non-blocking follow-ups for a future phase.
