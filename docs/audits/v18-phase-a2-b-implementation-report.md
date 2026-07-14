# V18 Phase A2 + B implementation report

Date: 14 July 2026

## Certification outcome

The repository implementation for A2 and B1-B7 is code-complete. All automated
tiers required for those packages are green on the implementation commit below,
including a clean 53-migration rebuild and the complete 105-test browser suite.

This is a technical certification, not fabricated shop evidence. Formal gates
G-A, G-B1 and G-B remain open until the named people complete the physical shop,
handset and trading-day observations in `docs/v18/00-implementation-plan.md`.
Accordingly, the repository is ready for production release preparation and the
field gates, but the V18 programme is not yet operationally complete.

## Repository

| Item | Value |
| --- | --- |
| Repository | `C:\Users\xxxsa\Desktop\plaicetomeat-ops` |
| Branch | `codex/v18-phase-a2-b` |
| Baseline | `d8270882eb51` |
| Implementation commit | `151d2818fbd2a0ebd0ce41f938489e9ff8a83212` |
| Migration count | 53 |
| Migration head | `202607142400_v18_atomic_evidence_finalize.sql` |
| Implementation scope | 187 files; 21,395 insertions; 2,015 deletions |

The exact file manifest is immutable in the commit and can be reproduced with:

```text
git show --name-status --format= 151d2818fbd2a0ebd0ce41f938489e9ff8a83212
```

Modified-file breakdown:

| Area | Files | Principal paths |
| --- | ---: | --- |
| Root, package and CI configuration | 6 | `.env.example`, `package.json`, `pnpm-lock.yaml`, `.github/workflows/*` |
| Architecture, playbooks and journey proof | 30 | `docs/agent-memory/*`, `docs/architecture/*`, `docs/operational-playbooks/*`, `docs/runbooks/*`, `docs/v14`-`docs/v18` |
| Workers and verification scripts | 26 | `scripts/owner-alert-worker.mjs`, `scripts/verify-*.mjs`, Playwright and seed runners |
| Application, domain and server source | 98 | `src/app/*`, `src/components/*`, `src/lib/*` |
| Migrations, seed and SQL tests | 12 | `supabase/migrations/20260714*.sql`, `supabase/seed.sql`, `supabase/tests/*` |
| Browser tests | 15 | `tests/e2e/*` |

Two pre-existing user edits were deliberately excluded from both the implementation
commit and this report's documentation commit:

- `docs/audits/ptm-operational-audit-input.md`
- `docs/reports/disaster-recovery-certification.md`

## Validation

All results below are from the final implementation tree on 14 July 2026.

| Required area | Result | Evidence |
| --- | --- | --- |
| Type safety | PASS | `corepack pnpm typecheck`, zero errors |
| Unit tests | PASS | Vitest: 96 passed files, 1 skipped file; 712 passed tests, 1 skipped test |
| Integration | PASS | Domain/server integration, SQL-fold parity, public-access security, business-state consumers and worker-runtime batteries |
| Database | PASS | Static and adversarial DB guards; payment, refund, amendment, inventory, owner-job, draft, run-completion and evidence fault batteries |
| Operator | PASS | Operator language/firewall, atomic serve, price presentation, drafts/resume, run completion and evidence flows |
| Owner brain | PASS | Owner jobs, Away accuracy, digest, alert delivery/lifecycle, certificate expiry and all 7 live journey guards |
| Workflow | PASS | Replay, fault-injection, rollback and two-connection race paths across the new workflows |
| E2E | PASS | `playwright:full`: 105/105 browser tests in 192.7 seconds |
| Counter update soak | PASS | Realtime/recovery test repeated three times: 6/6; cross-context updates within 3 seconds |
| Static guards | PASS | Architecture static tier: 8/8 |
| DB guards | PASS | Architecture DB tier: 8/8 |
| Live guards | PASS | Architecture live tier: 7/7 |
| Migration verification | PASS | Clean `supabase db reset` applied all 53 migrations; V11 clean/upgrade harness passed; generated manifest count/head matched |
| Build | PASS | Next.js 15.5.18 production build |
| Lint | PASS | Zero errors; six accepted pre-existing warnings |
| Release safety | PASS locally | Local release gate and production-readiness checks passed; production-only checks skipped without production credentials |
| Diff/index audit | PASS | `git diff --cached --check`; independent scope/secret/debug-artifact audit found no blocker |

The production release-mode check was also invoked without production authority.
It failed closed because build SHA, linked production credentials and fresh backup
evidence were absent. That is the intended safety boundary and remains an open
release prerequisite, not a failed implementation test.

The local database was reset once more after validation and left in the deterministic
development seed state. The reset applied the migration head successfully.

## Operational workflows completed

| Package | Completed workflow |
| --- | --- |
| A2 | Each/box products trade as whole counts while remaining explicitly `untracked_manual`; kg products retain controlled `kg_batch` or deliberate manual policy; untracked items never enter kg batch stock claims. |
| B1 | Critical alert debt is transactionally enqueued, leased by a bounded scheduled worker, delivered through the gated Twilio owner channel, and reflected by attempts, terminal failure and heartbeat state. A branch-local daily digest and urgent phone fallback are present. |
| B2 | `/admin/reconcile` is the single Owner jobs tray. Jobs are seen, claimed, linked or truth-resolved through a complete alert registry; Today and Owner Away point to the tray. |
| B3 | Managers can refund selected collected-order lines with a server-derived tender method and one honest stock disposition. Operator Help can flag the latest completed run as a mistake for owner follow-up. |
| B4 | Preparing/ready lines can be weight-adjusted, compatibly substituted or removed. Collection freezes one canonical SQL-folded version for display, tender and depletion. |
| B5 | Operator serve shows approximate line prices, review total and the authoritative persisted total, including a clear `Price updated` correction when necessary. |
| B6 | Serve, delivery and waste flows persist awaited, visible resume drafts without blocking the real operation. Same-day resume/start-fresh and atomic terminal run receipts prevent duplicate completion. |
| B7 | Certificate confirmation is removed from new opening sessions. Branch-local expiry scans create, escalate, reopen and truth-resolve Owner jobs; certificate evidence finalization is run-scoped and atomic inside PostgreSQL. |

## Newly protected invariants

- Product unit and inventory policy are constrained together. Each/box is always
  untracked; untracked products cannot receive inventory batches or contribute to
  kg quantity, valuation, expiry, cover, low-stock or purchasing claims.
- Each/box sale and refund quantities are whole counts. Untracked sales still enter
  immutable order/payment truth but never fabricate kg movements.
- Critical alert visibility and pending delivery debt are one database commit.
  `delivered_at` means confirmed provider acceptance only; disabled, ambiguous and
  terminal-failed channels remain visible.
- Owner Away order count and net takings derive from append-only payment events over
  the exact away window, not capped preview rows or mutable order status.
- Alert kinds have registered actions. Truth-backed jobs cannot be note-cleared while
  their underlying condition remains; automatic resolution and lifecycle audit commit
  together.
- Refund method is not a client input. Per-method refunds cannot exceed collected
  tender, per-line refunds cannot exceed frozen depleted quantity/value, and stock
  outcomes are exact reversals of original FEFO allocations.
- `customer_kept` creates no stock movement; `returned_restockable` reverses original
  depletion; `returned_discarded` reverses then records waste, preserving cost with
  net-zero return stock and no double depletion.
- Amendments are append-only ordered events. PostgreSQL is the single authoritative
  fold, stale sequence writes fail, and payment plus depletion consume the same frozen
  amendment sequence.
- Operator completion is run-id and fingerprint scoped. An exact replay returns the
  stored receipt; a conflicting replay cannot mutate a completed run.
- Evidence bytes are SHA-256 bound to a deterministic run-scoped object identity.
  Linked operational proof cannot be silently deleted or swapped.
- New facts remain branch/role checked behind server actions or security-definer RPCs;
  event truth is append-only and corrections use compensating facts.

No known invariant violation remains in the tested repository/local-database tree.

## New audit paths

- Inventory-policy changes, sales and reconciliations retain actor, branch and time
  through their existing product, order, payment and audit facts.
- Alert creation, delivery obligation, claimed attempts, provider responses, terminal
  failure, `delivered_at` and per-branch worker heartbeat form a durable delivery trail.
- Seen, claim, manual resolution, automatic resolution, reopen and severity escalation
  changes produce lifecycle evidence; certificate scans avoid no-op audit noise.
- Refund operation, selected lines, derived tender, disposition, money event, exact
  reversal/waste movements, threshold owner job and audit are joined by operation UUID.
- Amendment event sequence, before/after price and quantity, actor, reason, frozen
  collection sequence, tender and depletion are reconstructable from append-only facts.
- Draft state records the last successful resume point and repeated failure count;
  terminal operator runs store a completion fingerprint and receipt.
- Evidence upload/finalization/deletion uses durable evidence status and audit records;
  compliance documents link back to the captured run and evidence object.

## Rollback guarantees

- Collection status, tender, inventory depletion and audit either commit together or
  roll back; the fault battery proves a tender failure cannot leave a collected order.
- Refund money, line outcomes, exact stock reversal/waste, owner job and audit share one
  PostgreSQL transaction. Injected disposition failure leaves no refund payment event.
- Amendment append and repricing are one transaction. Amend/collect serialization means
  the losing operation exits cleanly without a half-frozen version.
- Delivery-cost resolution locks the batch and resolves the job with both audit facts;
  a mid-transaction fault leaves neither partial cost nor hidden job.
- Owner Away activation, its settings audit and immediate digest debt commit or roll
  back together.
- Operator serve/delivery/waste and certificate completion finalize the run and store
  their business result/receipt atomically; conflicting retries cannot partially win.
- Alert delivery can be stopped by disabling the channel without deleting alert debt.
  Ambiguous sends are terminal-visible and are never blindly replayed.
- Object storage cannot participate in a PostgreSQL transaction. Evidence deletion
  therefore uses an explicit request/remove/finalize saga; any boundary failure remains
  in a visible retryable state instead of claiming success.

Database migrations are expand-safe for application rollback, but there is no claim that
production has been migrated. Production rollback must follow the backup-first release
and application rollback runbooks.

## Concurrency guarantees

- Order collection, refund and amendment serialize on the order lock; amendment also
  uses expected sequence/advisory coordination. Real two-connection races proved one
  winner, one clean loser, and no duplicated money or depletion.
- Refund operation UUIDs, per-method balances and per-line caps make exact replays
  convergent while permitting distinct legitimate partial refunds.
- The alert worker leases with `FOR UPDATE SKIP LOCKED`, uses bounded batches and records
  the send-start boundary before external I/O. The scheduled workflow also forbids
  overlapping runs.
- Digest, Help, mistake, certificate and delivery-cost keys/indexes collapse duplicate
  creation attempts without hiding distinct operations.
- Owner-job resolution locks the target; concurrent cost resolution cannot overwrite the
  winning value or create duplicate open jobs.
- Operator-run completion locks the run and compares a durable fingerprint. Two-device
  completion returns the winning receipt for the same operation and rejects a conflict.
- Deterministic evidence identity, content hash and the run serialization fence make
  identical upload/finalize attempts converge and reject different bytes/details.

## Remaining risks and gates

### Production deployment

- This branch and its nine new V18 migrations have not been pushed or deployed by this
  task. Before any linked `db push`, verify production migration history, capture a fresh
  backup, supply the build SHA/production credentials, run strict release mode, deploy
  the application and smoke `/api/health` plus migration-manifest parity.
- The owner Twilio/WhatsApp channel still needs approved/credited sender details, real
  secrets, `OWNER_ALERT_CHANNEL_ENABLED=true`, and explicit acceptance of the documented
  at-most-once ambiguous-outcome boundary. Twilio Messages exposes no documented client
  idempotency-key contract, so an ambiguous provider outcome is terminal-visible rather
  than automatically retried.
- The local Supabase Realtime socket exhibited a JWT-signature degradation after reset.
  The counter now authenticates before subscribing and retains a two-second canonical
  safety refresh, and the soak passed, but production CDC/socket delivery still needs a
  post-deploy observation.
- `expected_open_time` is stored and defaults to 09:00, but this package does not add an
  owner-facing editor.
- Runtime errors have no external telemetry sink yet; production diagnosis still depends
  on platform logs.

### Real-world field evidence

- **G-A:** run the Phase-A reconciliation day, including the specified cash/card,
  each/box, double-tap, discrepancy, float and legacy-tender observations; run the timed
  Gul kg+each serve rehearsal and record zero abandoned sales.
- **G-B1:** receive a seeded critical alert on Dad's actual phone in under five minutes
  and observe a real morning digest. Provider acceptance alone is insufficient.
- **G-B:** trace a real refund, catch-weight amendment and mistake correction end to end;
  complete Owner Away stages 1-2; have Dad clear a seeded Owner jobs tray unaided.
- **OR-11:** can only be decided after Owner Away stage 3, including the one-week trial.
- Weak-network and real-device pilot behavior beyond the tested refresh/device paths
  remains field evidence, particularly around storage upload boundaries.

### Intentionally deferred

- Phase C and evidence-led Phase D are not part of this A2+B mission.
- Each/box stock counting, card-terminal integration, scale/barcode hardware, receipt
  printing, customer-SMS provider procurement, supplier PO/invoice matching, offline
  write queues, customer self-amendments, recall UI, transfers, sensors, native owner
  push and multi-branch operation remain out of scope under the implementation plan.

## Stop-condition assessment

| Condition | Status |
| --- | --- |
| A2 and B1-B7 implemented | Satisfied |
| Required automated validation tiers | Satisfied |
| Architecture, runbooks, reality maps and operational docs current | Satisfied |
| Known invariant violations in tested tree | None |
| Formal G-A/G-B1/G-B field evidence | **Open - requires real shop/people/provider** |
| Production release and parity | **Open - requires deployment authority and backup evidence** |

All repository work that can be proven locally for the requested scope is complete. The
next legitimate stop condition is external: production release preparation followed by
the recorded G-A, G-B1 and G-B field trials. Those outcomes must not be inferred from
green software tests.
