# V18 B1 — Alert Delivery Redesign (amended contract, v1.2)

Status: **Phases 1–2 implemented and Phase 2.5 dispatcher certification green**
(2026-07-15). Checkpoint commit `13922da`, tag `v18-phase2-alert-dispatcher-foundation`.
Supersedes the original B1 delivery design certified in `65a389f`, which was rejected for
four verified defects: free-form WhatsApp outside the 24-hour session window, GitHub
Actions cron as the timing authority, ambiguous provider outcomes converted to terminal
failures, and a claimed provider-idempotent retry contract the Twilio adapter could not
honour.

## 1. Locked architecture decision

```text
Transactional alert outbox (PostgreSQL)
        ↓
Supabase Cron every 30 seconds            ← timing authority
        ↓
Authenticated dispatch Edge Function      ← bounded sweep, NOT a resident worker
        ↓
Lease bounded batch (FOR UPDATE SKIP LOCKED)
        ↓
Web Push / FCM adapter (+ fallback channel)
        ↓
Record attempt, schedule bounded retry
```

- The database remains authoritative. Cron only wakes the dispatcher.
- An optional **fast path** (database webhook via asynchronous `pg_net`, fed by the
  `alert_dispatch_pending` NOTIFY trigger) may invoke the dispatcher immediately after a
  committed enqueue. It is an optimisation, never a correctness dependency.
- A reconciliation invocation recovers expired leases and detects SLA-risk dispatches
  (`recover_expired_alert_dispatch_leases_v18` runs at the start of every sweep; a
  dedicated 1–2 minute cron may also call it).
- **No session-level global sweep lock.** Edge Functions use transaction-mode pooling,
  where session advisory locks are unsafe. `FOR UPDATE SKIP LOCKED` plus strict batch
  bounds is the concurrency authority; overlapping sweeps contend on rows, never on a
  lock, and simply lease disjoint batches.
- GitHub Actions leaves the critical delivery path at Phase 7 cutover and is kept only
  for non-urgent reconciliation and reporting.

### Dispatcher execution budget (initial, all configurable)

```text
Cron frequency:                30 seconds
Maximum rows leased:           20 (hard cap 25 in SQL)
Maximum concurrent sends:      5
Per-provider request timeout:  8 seconds
Function soft deadline:        20 seconds  (stop leasing; finish in-flight sends)
Lease duration:                60 seconds  (SQL bounds: 15–300)
```

The free-plan Edge Function wall clock (150 s) is a platform limit, not an operating
budget: treating it as the budget would permit invocation overlap and long-stuck leases.

## 2. Accepted amendments (vs the original redesign spec)

1. **Runtime**: Supabase Cron–triggered Edge Function replaces the always-running
   process and the literal 2-second poll. 30-second wake keeps generous headroom inside
   the 5-minute SLA.
2. **`owner_alerts` is preserved** as the canonical alert *and* owner-job record — no
   parallel `owner_alert` / `owner_job` tables. Existing lifecycle columns
   (`seen_at`, `claimed_by`, `claimed_at`, `resolved_at`) remain. Acknowledgement is the
   only genuinely new fact (`acknowledged_at`, `acknowledged_by` +
   `acknowledge_owner_alert_v18`, idempotent, owner/manager-gated).
3. **Text truth references are kept** (`entity_ref` such as `opening:2026-07-15`,
   `order:<uuid>`, `checklist:<session>:<step>`). No UUID-only truth identity. Reopening
   semantics stay with the existing partial-unique indexes per kind (e.g.
   `... WHERE kind = 'checklist_skip' AND resolved_at IS NULL`), which already provide
   the lifecycle-generation behaviour: a resolved alert can reopen or recreate without
   colliding with history.

### Delivery-state separation (invariant 4.6)

`owner_alerts.delivered_at` is gone (it was never deployed). The four facts live apart:

```text
alert_dispatches.provider_accepted_at    — provider accepted the send
alert_dispatches.notification_opened_at  — handset opened the notification
owner_alerts.acknowledged_at             — owner explicitly said "I know"
owner_alerts.resolved_at                 — the underlying truth is handled
```

## 3. Data model (migration 202607141400, replaced wholesale)

The original `202607141400_v18_alert_dispatch.sql` was never applied to any remote
environment (verified 2026-07-15: prod migration head `202607111100`, all V18 versions
`remote:""`; the file never reached origin), so it was replaced in place rather than
compensated. Manifest regenerated; clean rebuild passes.

- **`owner_alert_kinds`** — fail-closed producer registry, seeded from
  `src/lib/domain/alert-registry.ts` (30 kinds). A `BEFORE INSERT` trigger on
  `owner_alerts` raises `UNREGISTERED_ALERT_KIND` for anything else. The read-side tray
  keeps its note-resolve fallback for historical rows; only *producers* fail closed.
  Static guard `verify:alert-registry` (in the architecture constitution, static tier)
  keeps the SQL seed and the TS registry one set.
- **`owner_notification_devices`** — registered channel targets
  (`web_push | fcm | telegram | ntfy`), credentials stored as ciphertext, lifecycle
  `enabled / verified_at / invalidated_at / consecutive_failures`. Invalid devices are
  disabled visibly, never deleted. Unique `(owner_id, installation_id, channel)`.
- **`alert_dispatches`** — one row per logical channel delivery. Stable identity
  `dispatch_key` (unique): `critical-alert:<alert_id>` for the legacy channel row,
  `critical-alert:<alert_id>:<channel>:<device_id>` per device,
  `digest:<branch>:<date>` / `digest-away:<branch>:<away_since>` for digests.
  Priority classes: critical 100, digest 10.
  Status machine:

  ```text
  pending ──lease──▶ leased ──record──▶ accepted            (terminal, provider accepted)
     ▲                 │                skipped             (terminal, channel disabled)
     │                 │                dead_letter         (terminal-visible, replayable)
     │                 ├─failed_transient─▶ retry_wait ──┐
     │                 ├─ambiguous────────▶ delivery_unknown ─┤   (both re-leasable)
     │                 └─lease expiry─────▶ delivery_unknown ─┘
     └───────────── manual replay (fresh attempt_budget) ◀── dead_letter/skipped/cancelled
  ```

  At-least-once: ambiguous outcomes and abandoned leases retry under the **same**
  `dispatch_key`; the client deduplicates on the dispatch id (push notification tag).
  `attempt_budget` (default 6) bounds the loop; `replay_alert_dispatch_v18` re-arms the
  same row with `attempt_budget = attempt_count + 6` so attempt history never renumbers.
- **`alert_delivery_attempts`** — one row per physical attempt, opened at lease time
  (worker id, request fingerprint) and closed by the recorded outcome
  (`accepted | rejected_permanent | failed_transient | ambiguous | worker_abandoned`).
- **`owner_alert_worker_status`** — dispatcher heartbeat, unchanged.

### RPC contract (service-role)

```text
lease_alert_dispatches_v18(worker_id, limit=20, lease_seconds=60) → SETOF dispatches
recover_expired_alert_dispatch_leases_v18() → recovered count
record_alert_dispatch_result_v18(dispatch_id, worker_id, outcome,
    provider_message_id?, provider_status_code?, error_code?, error_detail?,
    invalidate_device?) → dispatch
    (lease-checked; terminal states are idempotent ONLY for a true replay —
     same attempt, outcome, normalized provider/error payload and device-invalidation flag. A divergent replay raises
     DIVERGENT_RESULT_REPLAY; a late result for cancelled work returns quietly.)
record_alert_notification_opened_v18(dispatch_id) → dispatch (idempotent)
replay_alert_dispatch_v18(dispatch_id) → dispatch (terminal-only, audited)
enqueue_owner_digest_dispatch_v18(branch, date, target, payload, dispatch_key?) 
acknowledge_owner_alert_v18(alert_id) → jsonb    (authenticated owner/manager)
```

### Retry policy (unified, attempt-relative)

```text
Attempt 1: immediately        Attempt 4: +60 s
Attempt 2: +15 s              Attempt 5: +120 s
Attempt 3: +30 s              Attempt 6: +240 s   → dead_letter after 6
Jitter: random() * min(5 s, 20% of delay)
```

Because the dispatcher wakes every 30 seconds, a 15-second retry executes on the first
sweep at or after `next_attempt_at` (~30 s in practice); tests assert the schedule, not a
wall-clock promise. **Channel escalation is a separate mechanism from provider retries**:

```text
T+0:   all verified active owner devices (+ legacy channel row)
T+60:  configured fallback channel
T+240: SLA-at-risk
T+300: SLA breach recorded if no channel accepted
```

Escalation lands with Phase 4 (fallback channel); the priority/dispatch model already
supports it without schema change.

## 4. TypeScript contract (implemented)

- `src/lib/domain/alert-dispatch.ts` — `LeasedAlertDispatch`, `AlertDispatchOutcome`
  (`accepted | skipped | rejected_permanent | failed_transient | ambiguous`),
  `processLeasedAlertDispatches` (shared by the interim scheduled worker and the future
  Edge Function), retry-schedule mirror, batch bounds. The "crash after provider
  acceptance" property is now: recording failure propagates, the row stays leased,
  lease expiry → `delivery_unknown` → retried under the same identity — acceptance is
  never rewritten as failure, and nothing is silently dropped.
- `src/lib/domain/owner-alert-channel.ts` — Twilio adapter normalises to outcomes:
  transport failure → `ambiguous`, 408/429 → `failed_transient`, 5xx → `ambiguous`,
  other 4xx → `rejected_permanent`. Env rename:
  `OWNER_ALERT_TWILIO_AT_MOST_ONCE_ACCEPTED` → **`OWNER_ALERT_DUPLICATE_DELIVERY_ACCEPTED`**
  (the owner explicitly accepts that a retried ambiguous WhatsApp send may arrive twice;
  push channels deduplicate on the handset instead). The GitHub secret must be created
  under the new name before the interim worker next runs with delivery enabled.
- `src/lib/server/alert-dispatch.ts` — sweep uses recover→lease→send→record;
  delivery health reports in-flight (`pending|leased|retry_wait|delivery_unknown`) and
  `deadLetterCount` (dead letters are the "needs attention" signal in Owner Away).

## 4b. Phase 2 — Edge dispatcher (implemented)

**Runtime**: `supabase/functions/alert-dispatcher` (Deno). Each invocation is one
stateless sweep — recover expired leases → lease bounded batches → send with bounded
concurrency → record outcomes → return metrics. No hidden state, no in-memory queue, no
background loops; `FOR UPDATE SKIP LOCKED` in the lease RPC remains the only concurrency
authority, so any number of invocations (cron tick, webhook fast path, the interim
GitHub worker in shadow mode) safely coexist.

**Shared core**: `src/lib/domain/alert-dispatcher-core.ts` (`runDispatcherSweep`) is the
whole orchestration, importable by Deno, vitest and the DB guard alike — business rules
stay in the Phase 1 SQL RPCs and domain modules; the Deno entry only wires auth, the
Supabase client, the provider-timeout fetcher (`providerTimeoutMs`, default 8,000 ms;
configured by `ALERT_PROVIDER_TIMEOUT_MS`) and JSON logging. Batch loop:
lease up to `batchSize`, process, lease again only while the previous batch was full
**and** the 20-second soft deadline has not passed (`soft_deadline_hit` is reported).
Sends run in at most `maxConcurrentSends` lanes, and the dispatcher never knowingly
over-leases: a *subsequent* batch is leased only while
`remaining budget > maxConcurrentSends × providerTimeoutMs` (one full worst-case send
wave); metrics report why the loop stopped
(`stopped_reason: queue_drained | soft_deadline | insufficient_budget`).

Skipped-channel codes are deliberately two different facts:
`CHANNEL_NOT_IMPLEMENTED` (transient — no adapter compiled into this build; these
dispatches are the replay candidates when Web Push/Telegram/ntfy ship) versus
`CHANNEL_DISABLED` (permanent — the adapter exists but the channel is off or has no
target; not replay candidates). Neither is ever dead-lettered or lost.
A record-RPC failure aborts only its lane: the rows stay leased, expire, and recover as
`delivery_unknown` — the no-silent-loss path.

**Metrics** (returned per invocation and logged as `alert_dispatch_sweep`):
`leased, processed, accepted, retry_wait, delivery_unknown, dead_letter, skipped,
failed_sends, record_failures, expired_leases, batches, soft_deadline_hit, duration_ms,
remaining_budget_ms`. Every attempt logs `dispatch_id, attempt, invocation_id, channel,
outcome, status_after, provider_code, latency_ms, duration_ms`.

**Health**: `GET …/alert-dispatcher` (service token) → `ready` plus
`database_reachable`, `lease_rpc / recovery_rpc / record_rpc` (via the read-only
`alert_dispatcher_health_v18`, which checks the catalog instead of mutating the outbox),
`provider_configuration_loaded`, `version`, `build` (deployment id), `schema_version`
(applied migration head) and the production-support `queue` block: depth per state
(`pending / leased / retry_wait / delivery_unknown / dead_letter`), `expired_leases`,
`oldest_pending_seconds`, `oldest_dead_letter_seconds`.

**Security**: the function performs a constant-time Bearer-token comparison against
`ALERT_DISPATCHER_TOKEN` (default: the service role key). `verify_jwt` is off in
`config.toml` because "any valid project JWT" (including the public anon key) would be
weaker than this check. Service credentials never reach a browser.

**Scheduling** (migration `202607150900_v18_edge_dispatcher.sql`): timing authority is
Supabase Cron every 30 seconds, executing `invoke_alert_dispatcher_v18()`. That function
resolves the invoke URL and bearer token from Vault at execution time and **raises when
either secret is missing** — a broken configuration produces visibly failed cron runs in
`cron.job_run_details`, never the silent no-op that `net.http_post(url := NULL)` would
be, and no lease is ever claimed. Per-environment runbook:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/alert-dispatcher', 'alert_dispatcher_url');
select vault.create_secret('<service-role-or-dispatcher-token>', 'alert_dispatcher_token');
select public.schedule_alert_dispatcher_v18();          -- '30 seconds'
-- select public.unschedule_alert_dispatcher_v18();     -- to stop
```

plus `supabase functions deploy alert-dispatcher` and `supabase secrets set` for
`OWNER_ALERT_CHANNEL_ENABLED`, `OWNER_ALERT_DUPLICATE_DELIVERY_ACCEPTED`, `TWILIO_*`
(and optionally `ALERT_DISPATCHER_TOKEN`, `ALERT_DISPATCH_BATCH_SIZE`,
`ALERT_DISPATCH_MAX_CONCURRENT_SENDS`, `ALERT_DISPATCH_SOFT_DEADLINE_MS`,
`ALERT_DISPATCH_PROVIDER_TIMEOUT_MS`). An optional database webhook (pg_net on
`alert_dispatch_pending`) may invoke the same endpoint as a fast path; cron remains the
durable recovery mechanism.

**Shadow mode**: the GitHub-Actions worker stays for comparison until cutover — it
shares the same lease/record contract, so the two dispatchers never double-send.
Deliberate scope note: the Edge dispatcher only dispatches. The producers
(`scan_not_opened_by_time_v18`, certificate expiry scan, digest enqueue) remain with the
scheduled worker; they move to their own schedule at cutover planning, not in Phase 2.

**Execution budget** (env-overridable): batch 20, concurrency 5, provider timeout 8 s,
soft deadline 20 s, lease 60 s — the same numbers as §1.

## 5. Device registration is an operational gate (Phase 3)

```text
Installed as PWA (iOS ≥ 16.4 requires Home Screen install)
Permission granted from the installed app
Device subscription registered (server-side, encrypted)
Test notification sent and physically confirmed by the owner
Last successful test visible in PTM
Fallback channel configured
```

Web Push remains the preferred integrated path; Telegram/ntfy become the immediate
fallback only if the real handset proves fragile (decided at the G-B1 field gate, not
pre-emptively).

## 6. Rollout state

| Phase | Content | State |
| --- | --- | --- |
| 1 | DB foundation: registry, devices, dispatch lifecycle, attempts, leases, dead-letter, replay, ack; contract rewiring; guards | **Done** |
| 2 | Edge Function dispatcher + Supabase Cron 30 s + health endpoint + cron helpers (§4b) | **Done** (`13922da`, tag `v18-phase2-alert-dispatcher-foundation`) |
| 2.5 | Dispatcher certification: crash injection at every boundary, replay idempotency + divergent-replay hardening, over-lease budget invariant, staggered cron overlap, Vault fail-closed via `invoke_alert_dispatcher_v18`, health queue metrics, channel-code split | **Done (this change)** |
| 3 | Web Push: service worker, registration/verification flow, dedupe, deep links, `notification_opened` | Next |
| 3.5 | Real handset shadow mode (owner device, field-proven) | Pending |
| 4 | Fallback channel (Telegram or ntfy) + escalation timeline | Pending |
| 5 | Edge fixes from the redesign spec §19–22: checked `seen_at` updates, inventory-policy advisory-lock serialization, synchronous draft-saving state + flush, mistake-request rejection without a completed run | **Not yet implemented** |
| 6 | Shadow-mode and field certification/cutover as defined by the project plan | Pending |

The interim GitHub-Actions worker keeps running through shadow mode on the new
lease/record contract, so alert delivery never regresses below the previous baseline
while Phases 2–3 land.

## 7. Verification (2026-07-15, Phases 1–2 + 2.5 certification)

- Unit: 723 passed / 1 skipped (dispatch contract, adapter classification,
  dispatcher-core orchestration incl. soft deadline, over-lease budget invariant both
  ways, bounded concurrency, channel-code skip, classification pass-through,
  record-failure lane isolation).
- Static constitution tier: 9/9 (includes the `alert-registry` parity guard).
- Clean rebuild: `supabase db reset` applies all 54 migrations from scratch.
- DB tier: constitution 10/10 (now includes `edge-dispatcher` and
  `dispatcher-certification`); `verify:alert-dispatch` 21/21; `verify:edge-dispatcher`
  8/8; **`verify:dispatcher-certification` 9/9** — crash injection at each boundary
  (after lease; after provider acceptance / before record; after record commit)
  converges to exactly one legal state with no orphan lease or attempt; a crashed
  worker's late result is rejected once the lease is lost; identical replay is exactly
  one transition while a different outcome or normalized provider/error payload raises
  `DIVERGENT_RESULT_REPLAY`; concurrent sweeps and a staggered second invocation
  mid-sweep produce zero duplicate sends, zero starvation and exactly one attempt per
  dispatch (without requiring a fixed work split); a missing Vault secret makes the cron invocation
  fail loudly with zero leases claimed; and the global sanity invariants
  (leased ⇔ lease fields, open attempt ⇒ leased, attempt_number ≤ attempt_count,
  attempt_count ≤ attempt_budget) hold over the whole table;
  `verify:owner-jobs` 40/40; payment-truth 39/39; refund-truth,
  operator-run-completion, atomic-evidence, atomic-operator-serve all green.
- Live tier: not run (no app server booted; the only UI delta across all phases is one
  Owner Away banner string).
- Not exercised locally: an actual Edge-runtime invocation (`supabase functions serve` /
  a deployed function) — the Deno entry is thin wiring over the fully-tested core and is
  proven at Phase 3.5/6 shadow mode; and upgrade-from-prod-head, which stays enforced by
  `.github/workflows/migration-upgrade.yml` before merge.
- Upgrade-from-prod-head: enforced by `.github/workflows/migration-upgrade.yml` in CI —
  must be green before merge.
