# V18 B1 Phase 3 — Web Push implementation report

Status: implemented and locally certified on 2026-07-15. Real handset reliability remains Phase 3.5.

## Delivered

- Forward migration `202607151500_v18_web_push.sql` extends the sealed device/outbox contracts.
- Device lifecycle keeps verification, operator disable and provider invalidation as separate causal facts.
- `eligible_owner_notification_devices_v18` is the single normal-delivery eligibility authority.
- Authenticated owner RPCs register encrypted subscriptions, create real outbox-backed verification sends,
  confirm accepted challenges, rename/disable/re-enable devices and record first-open evidence.
- The Web Push adapter implements the existing `DispatchChannelAdapter` boundary. It resolves/decrypts one
  subscription, validates the versioned payload, sends via VAPID Web Push and returns normalized outcomes.
- The single PTM service worker validates schema version, deduplicates by stable dispatch ID, displays,
  deep-links and hands open evidence to the authenticated app. It contains no business mutations.
- The owner notification-settings surface performs capability-led permission, subscription, registration,
  test-send and explicit confirmation, and exposes disabled/invalidated recovery states.

## Added contracts

### Migration

- `202607151500_v18_web_push.sql`

### RPCs and views

- `eligible_owner_notification_devices_v18`
- `register_owner_notification_device_v18`
- `create_owner_notification_verification_v18`
- `confirm_owner_notification_verification_v18`
- `expire_owner_notification_verifications_v18`
- `set_owner_notification_device_enabled_v18`
- `rename_owner_notification_device_v18`
- `record_owner_notification_opened_v18`
- `web_push_health_v18`

### API routes

- `GET|POST /api/owner/notifications/devices`
- `POST /api/owner/notifications/devices/:deviceId/test`
- `POST /api/owner/notifications/devices/:deviceId/verify`
- `POST /api/owner/notifications/devices/:deviceId/state`
- `POST /api/owner/notifications/:dispatchId/opened`
- `GET /api/owner/notifications/vapid-public-key`

## Security and evidence

Subscription endpoint, `auth` and `p256dh` values are independently AES-256-GCM encrypted before the
service-role persistence boundary. Ciphertext is never returned in browser DTOs. The adapter decrypts only
inside the Edge runtime and never logs subscription or VAPID material. Registration identity is the owner,
installation UUID and channel; the endpoint is only part of a non-reversible subscription fingerprint.

Provider acceptance, notification open, owner acknowledgement and operational resolution remain four
separate timestamps. An open replay preserves the first timestamp and cannot acknowledge or resolve work.

## Configuration

Required Edge/server secrets:

```text
WEB_PUSH_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY
WEB_PUSH_SUBJECT
OWNER_NOTIFICATION_ENCRYPTION_KEY
```

Missing VAPID or decryption configuration makes the implemented adapter `CHANNEL_DISABLED`. Future channels
without adapters remain `CHANNEL_NOT_IMPLEMENTED`.

## Validation and limitations

The Phase 3 guards cover concurrent registration, mandatory verification, challenge identity/expiry,
canonical eligibility, independent multi-device fan-out, disable/re-enable, per-device provider invalidation,
authorized idempotent open evidence, adapter classification, payload bounds/routes and service-worker boundaries.

Final local gates:

```text
unit                       748 passed, 1 skipped
focused Phase 3 suite      35/35
Web Push database guard    14/14
Web Push static guard      9/9
alert dispatch guard       21/21
edge dispatcher guard      8/8
dispatcher certification   9/9
static constitution        10/10
database constitution      11/11
clean migrations           55/55
typecheck                   0 errors
lint                        0 errors (6 existing warnings)
production build            passed
```

The actual local Supabase Edge runtime loaded `npm:web-push`, returned ready health for
`v18-b1-phase3`, registered `web_push`, and reported it implemented but disabled without
local secrets. The authenticated settings route also passed a browser smoke check. The
browser permission prompt was not accepted and no external provider request was made.

No real provider push, handset, iOS or Android proof is claimed here. GitHub worker and interim producer scans
remain unchanged. Phase 3.5 entry requires configured secrets and repeated shadow delivery on the owner's real
installed handset without weakening database authority.
