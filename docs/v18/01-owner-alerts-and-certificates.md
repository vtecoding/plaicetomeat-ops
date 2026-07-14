# V18 owner alerts, owner jobs and certificates

This is the implementation note for packages B1, B2 and B7. The database is
the authority for alert debt and lifecycle; the browser never performs an
external notification directly.

## Delivery contract

A critical `owner_alerts` insert and its pending `alert_dispatches` row are one
PostgreSQL transaction. If either insert fails, neither commits. A scheduled
worker leases at most 25 due rows with `FOR UPDATE SKIP LOCKED`, records a
durable send boundary, calls the configured channel, and records the result.
`owner_alerts.delivered_at` is set only after a confirmed provider acceptance.

The current adapter uses Twilio WhatsApp. Twilio's Messages API does not expose
a documented client idempotency key, so the repository does **not** claim
provider-side replay deduplication. Before network I/O the worker persists
`send_started_at`. A transport error, 5xx response, or crash beyond that
boundary becomes a terminal, visible failure and is not automatically retried.
This chooses at-most-once sending: an uncertain message may be missed, but it is
never blindly duplicated. Definite rejections such as rate limiting may retry,
with five attempts maximum.

The channel remains disabled unless all of these are set:

- `OWNER_ALERT_CHANNEL_ENABLED=true`
- `OWNER_ALERT_TWILIO_AT_MOST_ONCE_ACCEPTED=true`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_OWNER_FROM`
- a branch `owner_contact`

The explicit acceptance switch records the operational decision to use the
at-most-once contract. When disabled, work remains visible in Owner jobs and the
operator Help screen exposes the branch phone number. Setup and Owner Away show
the missing-channel warning. Terminal failures remain visible even if the
channel is later disabled.

The worker records a per-branch configuration heartbeat in
`owner_alert_worker_status` after every run. Setup and Owner Away use a recent
(at most 20 minutes old) worker observation, rather than the web process's
environment, to say whether the channel and target are actually configured. A
missing or stale heartbeat is shown as an operational warning; it is never
presented as proof that delivery is healthy.

The workflow's `field_proof` input requires at least one claimed dispatch and
provider acceptance for every claimed row. That proves the provider accepted
the request; it does **not** prove Dad's handset received or displayed it. Gate
G-B1 remains open until a seeded critical alert is observed on Dad's phone in
under five minutes and a real morning digest is observed.

## Scheduling and replay

`.github/workflows/owner-alert-dispatch.yml` runs every five minutes with a
bounded batch of ten. One concurrency group prevents overlapping workflow runs.
Each run:

1. creates branch-local not-opened alerts after `expected_open_time` (09:00 by default;
   this Phase-A package stores the branch setting but does not add an owner-facing editor);
2. scans supplier certificates using each branch's own local business date;
3. enqueues the due branch-local daily digest once;
4. finalises stale ambiguous sends as terminal failures;
5. leases and sends one bounded outbox batch.

Digest keys are stable per branch and business date. Turning Owner Away on uses
one stable key per actual off-to-on transition. Replays and double-clicks retain
the original `away_since` and converge on the same immediate digest row.
The off-to-on state change, its settings audit and that immediate digest debt
commit in one transaction; an outbox conflict rolls all three back.

Owner Away sales use `payment_events`, not mutable order subtotals or order
status. The headline order count is the uncapped count of distinct orders with
a sale event inside the exact away window. “Net takings” is sale money less
refund money in that same window. The latest-sales preview is bounded to 20 and
shows each sale's frozen gross collection amount; incoming or ready orders with
no payment event do not appear.

## Owner jobs lifecycle

`/admin/reconcile` is the single Owner jobs tray. Every unresolved alert kind is
hydrated through `ALERT_KINDS`; unknown historical kinds fall back to a safe
note-and-resolve action. Reading the tray stamps `seen_at`. Manual resolution is
available only for kinds whose registry rule has no truth-backed auto-resolver.
Inventory, checklist, opening and certificate jobs therefore cannot be hidden
with a note while the underlying problem remains.

Manual note resolution uses one service RPC that validates actor and branch,
locks the alert, applies the resolution and appends its audit in the same
transaction. Delivery-cost resolution additionally locks the inventory batch;
the cost, owner-job resolution and both audit records commit together. Exact
replays converge, a competing value cannot overwrite the winning cost, and a
mid-transaction failure leaves neither a cost nor a resolved job.

Database-side automatic resolution rules are:

- inventory shortfall: the named product is counted or adjusted;
- checklist skip/help: the same session step is later completed;
- not opened by time: that branch/day's opening checklist completes;
- certificate expiry: a newer document supersedes it or it leaves the 30-day
  window.

Every automatic lifecycle change appends an
`owner_alert_lifecycle_changed` audit in the same transaction. Certificate
scans distinguish `created`, `reopened`, `escalated`, `refreshed` and
`auto_resolved`; an unchanged scan writes no duplicate transition.

Delivery-cost alert creation is sealed by a partial unique index and an atomic
ensure function, so concurrent delivery save and tray self-heal cannot create
two open jobs. Urgent Help uses a client-generated operation UUID plus a database
unique index; retrying one tap creates one alert and one outbox debt.

## Certificate ownership

New opening sessions bind to opening definition v2 with four steps:
`fridge_temp`, `display_ready`, `float_ready`, and `open_sign`. Historical
sessions remain on their stored definition version. `certs_visible` is not
accepted for a new opening.

The worker scans every branch, including branches that have not yet saved Owner
Away settings. The branch-scoped scan creates one `certificate_expiring` job per
current supplier document at 30 days or fewer. It is a warning at 8-30 days and
critical at 7 days, today, or expired. A warning-to-critical transition creates
urgent delivery debt exactly once. The tray links to `/admin/compliance`.
Legacy manually-cleared certificate jobs are reopened by the next scan if the
document is still at risk.

Photographing a paper has one external boundary: private object storage. The
upload uses a deterministic run-scoped path and evidence identity, with the
stored bytes bound to the evidence row by SHA-256, so identical concurrent
submissions converge while a different photo on the same run is rejected. Once that row
exists, `complete_operator_certificate_v18` validates its branch, uploader, run,
status, object path and expected evidence type, then creates/reuses the
compliance document and owner job, links the evidence, completes the workflow
run and writes audits in one database transaction. The run is the serialization
fence: an identical retry returns the stored receipt; different paper/evidence
details are rejected.

## Verification

Run against a clean, seeded local Supabase stack:

```text
pnpm verify:alert-dispatch
pnpm verify:owner-away
pnpm verify:owner-jobs
pnpm verify:owner-alert-worker-runtime
node scripts/verify-shortfall-owner-alert.mjs
pnpm typecheck
pnpm test
```

`verify:alert-dispatch` covers transactional rollback, leasing, delivery stamps,
bounded retries, ambiguous outcomes, atomic Owner Away replay and payment-ledger
totals beyond the preview cap. `verify:owner-jobs` covers claim races, critical
checklist outbox creation, automatic resolution and lifecycle audits,
cross-branch permission denial, Help and delivery-cost fault/concurrency cases,
atomic certificate-capture replay/type validation, and branch-local certificate
creation, no-op scanning, reopen, escalation and renewal.

## Operational rollback

Turn `OWNER_ALERT_CHANNEL_ENABLED` off to stop network sends without losing
in-app alert debt. Do not delete failed or ambiguous dispatches: they are the
audit trail. A provider/account change requires a reviewed adapter change or a
fresh explicit acceptance of its delivery semantics; never add an undocumented
idempotency header.
