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

## Verdict

- Phase 3.5 real desktop-browser shadow chain: **PASS**.
- Phase 3.5 field defects P3.5-01 through P3.5-04: **FIXED AND DEPLOYED**.
- Generic notification presentation P3.5-05: **RECORDED, NON-BLOCKING**.
- Real owner handset delivery certification: **OPEN**.
- Production cutover: **NOT CLAIMED**.
- Dispatcher cron remains unscheduled and the GitHub worker remains available.
