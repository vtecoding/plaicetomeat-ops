# V18 B1 Phase 3.5 — Web Push Shadow Validation

Date: 2026-07-15 to 2026-07-16

Phase 3 release under test: `b80de87876a376798d4f3dfb7f0efe21ad67835f`

Deployed field-fix checkpoint: `edcee6ede6fb86e9863374cbb81129f1280a9178`

Supabase project: `qwvlzcqmicedxhfafiar`

Mode: manual Edge invocation; dispatcher cron unscheduled; GitHub worker retained.

## Production entry proof

- Fresh encrypted full-logical backup: GitHub run `29439824446`.
- Restored into isolated local database `ptm_phase35_scratch_20260715`.
- Restore result: 49 public tables, RLS 49/49, five Auth users, zero orphaned profiles, five orders.
- Production upgraded from 41 to 55 migrations and application build `b80de87` deployed.
- Real Edge health: ready, Web Push implemented/configured, schema `202607151500`.
- Before deploying the field fixes, encrypted backup run `29457631282` was restored into
  `ptm_phase35_fix_scratch_20260715`: 61 public tables, RLS 61/61, five Auth users, zero orphaned
  profiles, and five orders.
- Post-fix production health: application build `edcee6e`, 56/56 migrations at head `202607152315`,
  verified backup current, one verified active device, and an empty dispatch queue.

## Real delivery evidence

Device `6d80b9e2-e8b5-45fa-ada1-09c1324253e7` was registered from the owner's real Windows PC browser,
received provider-accepted verification notifications, and was explicitly confirmed at
`2026-07-15T22:53:12.680005Z`. The device became eligible only after that confirmation.

This proves the real browser/desktop chain. It is not evidence of delivery to a handset.

Measured evidence:

| Proof | Result |
|---|---|
| Real Edge sweep | PASS — cloud function `v18-b1-phase3` |
| Push provider acceptance | PASS — HTTP 201 |
| Provider attempt latency | 215–474 ms during the first wave |
| Single verification sweep | 353 ms |
| Verification accepted → explicit confirmation | 10.27 s (human interaction included) |
| First notification accepted → authenticated open | 8.77 s |
| Controlled alert queued → provider accepted | 7.49 s (manual invocation delay included) |
| Controlled alert Edge sweep | 430 ms |
| Controlled alert accepted → authenticated open | 234.56 s (deliberate human wait included) |
| Duplicate suppression | PASS — two provider accepts with one payload `dispatchId`, one visible notification |
| Authenticated open evidence | PASS — primary dispatch opened at `2026-07-15T22:58:41.526126Z` |
| Explicit acknowledgement | PASS — owner acknowledged at `2026-07-15T23:14:06.608931Z` |
| Acknowledgement vs resolution | PASS — `resolved_at` and `resolution_note` remained null after acknowledgement |

Controlled alert: `f3369425-519c-43ba-9b88-f469a4f3dca0`.

Stable payload dispatch id: `d2f7f84b-a032-4086-bc7c-6833f27d38f5`.

## Field defects

### P3.5-01 — superseded verification dispatches remained sendable

Repeated test clicks cancelled old challenges but left their pending dispatch rows eligible. Six distinct
verification requests were therefore accepted in the first manual sweep. Fix: forward migration
`202607152315_v18_phase35_web_push_field_fixes.sql` cancels pending/retry/unknown dispatch debt whenever
its challenge becomes cancelled or expired. It does not rewrite accepted history.

### P3.5-02 — verification deep link lost confirmation identity

`notificationclick` navigated the page, clearing React-only challenge state. Fix: new verification payloads
carry both challenge and device identity, and the settings page reconstructs the explicit confirmation control.

### P3.5-03 — owner-alert deep link did not surface its target

The URL reached `/admin/today?alert=...`, and authenticated open evidence was recorded, but the target alert
was not visible. Fix: Today renders a focused owner-alert card for the authorized branch and exposes an
acknowledge-only action. Acknowledgement never resolves the alert; resolution remains in Owner Jobs.

### P3.5-04 — shadow workers could consume each other's channels

Both workers used the unfiltered lease RPC, so a worker without the relevant configured adapter could terminally
skip another worker's row. Fix: a forward channel-scoped lease RPC; Edge defaults to `web_push`, while the retained
GitHub/server worker leases only `twilio_whatsapp`. The original generic lease RPC remains unchanged.

### P3.5-05 — generic notification presentation

Windows displayed a functional but visually generic Chrome notification. This is recorded as a non-blocking
presentation issue. It does not affect identity, deduplication, deep linking, open evidence, acknowledgement, or
delivery truth and is not expanded into a new feature during Phase 3.5.

## Fix verification

- Clean rebuild: 56/56 migrations, head `202607152315`.
- Web Push static guard: 13/13.
- Web Push database guard: 17/17.
- Alert dispatch: 21/21.
- Edge dispatcher: 8/8.
- Crash/replay certification: 9/9.
- Static/database constitution: 21/21.
- Unit: 749 passed, one skipped.
- Typecheck and production build: pass.
- Lint: zero errors; six existing warnings.

## Post-fix production field retest

- The deployed deep link rendered the authorized alert in a focused **Opened from notification** card.
- The owner explicitly acknowledged it in PTM. The authoritative `owner_alerts` row recorded
  `acknowledged_at` and `acknowledged_by`, while `resolved_at` and `resolution_note` remained null.
- Provider acceptance, notification open, acknowledgement, and resolution therefore remain four distinct facts.
- Production Edge invocation `edge:9e9d9aa4` ran while an inert `twilio_whatsapp` probe was eligible. Edge
  leased and processed zero rows; the probe remained `pending` with `attempt_count = 0` and no lease owner.
  The probe was removed immediately afterward. This proves the deployed Edge worker leases only its owned
  `web_push` channel while the retained GitHub/server path owns `twilio_whatsapp`.

## Real owner handset certification

Date: 2026-07-16

Outcome: **COMPLETE**

Final application build: `c4c1e6a`

Final Edge build: `qwvlzcqmicedxhfafiar_c5c76d08-2218-45b9-b141-6fad8d1e21d9_5`

Final schema: `57/57`, head `202607161505`

### Handset environment

| Detail | Evidence |
|---|---|
| Manufacturer / model | Samsung Galaxy Note20 Ultra 5G — owner-reported |
| OS | Android 13 — owner-reported; reduced Chrome UA advertised Android 10 |
| Browser | Chrome `150.0.0.0` from the registered user agent |
| Installation mode | Directly in Chrome; not installed as a PWA / Home Screen app — owner-reported |
| Notification permission | Granted; PTM derived state `active` after explicit verification |
| Network | Wi-Fi active; mobile data also enabled — owner-reported |
| Registration platform | `Linux armv81` |
| PTM state tested | Foreground, background/closed, signed-out redirect, and signed-in |
| Lock state tested | Unlocked and locked |
| Battery optimisation | Not inspected; it was not implicated because locked/backgrounded delivery passed |

No private push endpoint, subscription key material, VAPID private key, or notification encryption key is
recorded in this report.

### Device isolation and verification

The handset registered as device `954b24b5-a7ad-47b9-92c6-f832fe565c15`, installation
`89488ee0-a7e7-405e-93f5-6dac47cba7b9`. The certified desktop remains device
`6d80b9e2-e8b5-45fa-ada1-09c1324253e7`, installation
`82a138e5-5820-4549-857f-d3f56538ba55`. The device and installation identities are therefore independent.

System-generated verification evidence:

| Event | Timestamp / result |
|---|---|
| Handset registered | `2026-07-16T10:42:57.176465Z` |
| Verification challenge created | `2026-07-16T10:42:58.206572Z` |
| Verification dispatch | `02f05664-8c97-4cc4-8042-54d81105be44` |
| Provider accepted | `2026-07-16T10:46:15.874167Z`, HTTP 201 |
| Challenge confirmed | `2026-07-16T10:48:25.027623Z` |
| Device verified / eligible | `2026-07-16T10:48:25.027623Z` |
| Final verified active devices | `2` |

Owner-observed physical evidence:

- The verification notification visibly appeared on the real handset after provider acceptance. The owner did
  not record a separate wall-clock timestamp, so this observation is intentionally not presented as a database
  timestamp.
- Tapping it opened PTM, required authentication, and returned to Notification devices.
- The owner explicitly pressed **I received the test**; PTM changed the handset from `unverified` to `active`.
- The flow felt slow to the owner. This is recorded as a non-blocking performance observation; no timing redesign
  was added to the certification scope.

The first signed-out verification tap exposed P3.5-06 below: the root open recorder had already mounted on the
login page and did not re-run after the authenticated redirect. The later locked-handset alert repeated the same
signed-out path after the fix and recorded its authenticated open successfully.

### Controlled alert, deep link, open and acknowledgement

Authoritative alert `0d8d17c8-3134-43c0-8637-9c6eb07b05db` was explicitly labelled controlled evidence.
Its handset dispatch was `2a61dbc0-7536-4d91-bc9a-539851fd916b`.

| Evidence | Result |
|---|---|
| Alert created | `2026-07-16T10:58:22.722845Z` |
| Handset provider accepted | `2026-07-16T10:58:23.481115Z`, HTTP 201 |
| Visible on handset | PASS — owner-observed, exactly one |
| Deep link | PASS — focused **Opened from notification** owner-alert card with the matching controlled summary |
| Authenticated open | `2026-07-16T11:06:52.122136Z` |
| Pre-acknowledgement state | `acknowledged_at = null`, `resolved_at = null` |
| Explicit acknowledgement | `2026-07-16T12:07:04.230540Z` |
| Post-acknowledgement resolution | `resolved_at = null`, `resolution_note = null` |

The owner reported the card text **Acknowledged — still open until resolved**. PTM did not acknowledge on open and
did not resolve on acknowledgement.

### Locked handset and duplicate suppression

Locked/backgrounded alert `78f4e8e9-ca8f-4d02-96f2-35e683f0c1e3` used handset dispatch
`4a38db0b-f5d3-4d43-856a-22353766b90a`.

| Evidence | Result |
|---|---|
| First provider acceptance | `2026-07-16T13:57:51.170887Z`, HTTP 201 |
| Locked OS notification UI | PASS — owner observed it while the phone was locked and PTM backgrounded/closed |
| Tap / authenticated redirect | PASS — sign-in required, then the matching focused owner alert opened |
| Authenticated open after sign-in | `2026-07-16T13:58:58.561102Z` |
| Same-dispatch replay | PASS — same dispatch ID, attempt 2, no second alert row |
| Second provider acceptance | `2026-07-16T14:02:13.430170Z`, HTTP 201 |
| Second visible notification | NONE — owner-observed handset dedupe pass |
| Open timestamp after replay | Unchanged at `2026-07-16T13:58:58.561102Z` |
| Acknowledged / resolved | Both null |

The owner accidentally dismissed an earlier controlled notification rather than tapping it. That alert
`d3ffedb0-58a3-4b6b-b3e0-c4a6920124df` is retained as physical one-notification evidence but is not used for the
authoritative open/acknowledgement chain.

### Multi-device, channel isolation and final queue

Every controlled alert created one independent Web Push dispatch for the desktop and one for the handset. For the
locked alert, desktop dispatch `489236a9-d35b-48f9-85ff-1c95c2d00a6f` and handset dispatch
`4a38db0b-f5d3-4d43-856a-22353766b90a` were independently provider-accepted. Neither device reported a provider
failure, and the handset replay changed only the handset row.

Each controlled alert also created an inert `twilio_whatsapp` row under the legacy channel contract. Four Edge
sweeps leased only `web_push`; the three inert rows remained `pending`, `attempt_count = 0`, with no delivery
attempt. After evidence capture, only those three test-channel rows were deleted as explicit test cleanup. No
customer or WhatsApp delivery occurred.

Final production state:

```text
pending = 0
leased = 0
retry_wait = 0
delivery_unknown = 0
dead_letter = 0
expired_leases = 0
open attempts = 0
verified active devices = 2
```

The `ptm-alert-dispatcher` cron job remains absent. Edge health is ready, Web Push is implemented/configured,
VAPID public/private/subject and subscription decryption are configured, and the retained server/GitHub worker
runtime still loads to its expected missing-environment guard. The GitHub workflow was not removed. No cutover or
schedule activation is claimed.

### Handset-phase defects and fixes

#### P3.5-06 — authenticated open evidence was lost across sign-in

Observed: a signed-out notification tap returned to the intended route after login, but the root recorder's
one-shot effect had already run on the login page, so `notification_opened_at` stayed null.

Fix: `4bd264e` makes the recorder react to `useSearchParams()` changes, validates the dispatch identity through a
tested helper, and keeps the database transition idempotent. The locked-handset post-login retest recorded the open
at `2026-07-16T13:58:58.561102Z`. Status: **FIXED AND DEPLOYED**.

#### P3.5-07 — accepted dispatches could not use the administrative replay contract

Observed: `replay_alert_dispatch_v18` described terminal replay but excluded `accepted`, preventing the required
same-dispatch physical dedupe probe without rewriting authoritative state.

Fix: forward migration `202607161505_v18_phase35_accepted_dispatch_replay.sql` permits accepted terminal rows to
re-arm under the same ID and fresh bounded budget. The database guard now covers the accepted replay path. The real
handset replay produced provider attempt 2 and no second visible notification. Status: **FIXED AND DEPLOYED** in
`c4c1e6a`.

#### Shadow invocation configuration

The database Vault has no `alert_dispatcher_url`, so `invoke_alert_dispatcher_v18()` fails closed and the cron
cannot be scheduled accidentally. The stale custom Edge bearer was rotated to the function's documented
service-role authorization contract for manual shadow sweeps. Direct authenticated Edge health and sweeps pass.
This does not schedule the dispatcher and is retained as a launch-time configuration step, not a handset defect.

### Automation and evidence gates

- In-app Playwright/browser: authenticated owner Today and Notification devices routes opened; the device list and
  active desktop state were inspected before handset registration; URLs, browser errors, and capability state were
  inspected. Physical handset display was never substituted with emulation.
- Hosted Playwright after final deploy: 10/10.
- Unit: 751 passed, one skipped.
- Focused notification/open tests: 8/8.
- Web Push static guard: 14/14.
- Web Push database guard: 17/17.
- Alert-dispatch guard: 22/22.
- Edge dispatcher guard: 8/8.
- Crash/replay certification: 9/9.
- Clean database rebuild: 57/57 migrations.
- Migration manifest, typecheck, production build, `git diff --check`, and staged secret-pattern scan: pass.
- Owner-alert fallback worker runtime: pass.
- Final application health, Edge health, schema parity, queue, lease and cron checks: pass.
- No handset screenshot was retained; physical visibility is explicitly owner-observed evidence, and no secret or
  subscription material was captured in an image.

Controlled test alerts remain open so the captured `resolved_at = null` evidence is preserved. This is documented
test evidence, not production customer work. No manual database repair was required.

## Verdict

- Phase 3.5 real desktop-browser shadow chain: **PASS**.
- Phase 3.5 real owner handset shadow chain: **PASS**.
- Phase 3.5 field defects P3.5-01 through P3.5-04: **FIXED AND DEPLOYED**.
- Phase 3.5 handset defects P3.5-06 and P3.5-07: **FIXED AND DEPLOYED**.
- Generic notification presentation P3.5-05: **RECORDED, NON-BLOCKING**.
- Real owner handset delivery certification: **COMPLETE**.
- Production cutover: **NOT CLAIMED**.
- Dispatcher cron remains unscheduled and the GitHub worker remains available.
