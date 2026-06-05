# ADR 0001 — Public Order Access Boundary (V11.1)

**Status:** Accepted (V11.1)
**Date:** 2026-06-05
**Supersedes:** the V2 reference-only public order flow
(`getOrderByRef` + `cancel_order_by_ref`).

## Context

The pre-V11 public order flow used the human order reference (`PTM-YYYY-NNNNN`)
as an access credential:

- `/order/[orderRef]` loaded the **full internal order** via the service-role
  client (`getOrderByRef` → `ORDER_SELECT`), exposing customer name, items and
  subtotal to anyone who knew/guessed a reference.
- `/order/[orderRef]/cancel` + `cancel_order_by_ref(p_order_ref, p_reason)`
  cancelled an order using only the reference, granted to `anon`, with **no row
  lock** before the status check/update.

References are **sequential and enumerable**, so this is an unauthenticated data
disclosure + unauthorised cancellation defect (spec §1, Appendix A.1–A.5).

## Decision

### Invariants introduced (release requirements, spec §6.1)

1. A sequential order reference must never authorise data access.
2. A public user must not retrieve an order using only `order_ref`.
3. A public user must not cancel an order using only `order_ref`.
4. Public status responses contain only the documented safe DTO
   (`PublicOrderStatus`). No phone, email, raw order id, notes, staff notes, SMS
   diagnostics, branch internals.
5. Public lookup, access establishment and cancellation are rate-limited.
6. Cancellation locks the target row (`FOR UPDATE`) and re-checks status inside
   one transaction; a cancellation racing a staff transition yields exactly one
   valid winner.

### Mechanism

- New columns on `orders`:
  `public_access_id uuid not null default gen_random_uuid() unique`,
  `public_access_revoked_at timestamptz`,
  `public_access_version integer not null default 1`.
  `public_access_id` is a random, unguessable (122-bit) handle. The sequential
  `order_ref` remains a **display label only**.
- Status route is keyed by the random id: `/order/status/[publicAccessId]`.
  Viewing the safe DTO requires knowing the unguessable id (handed to the
  customer at checkout). Reference enumeration yields nothing.
- Three `anon`-granted `SECURITY DEFINER` RPCs, each returning only safe data:
  - `get_public_order_status(public_access_id)` → safe DTO jsonb (or NULL if
    unknown/revoked).
  - `establish_public_order_access(order_ref, phone)` → returns the
    `public_access_id` **only** when `order_ref` + normalized phone match. This
    lets a returning customer (who only kept the printed reference) re-establish
    access. Rate-limited.
  - `cancel_public_order(public_access_id, reason)` → locks the row, re-checks
    `incoming` + deadline, performs a conditional transition, writes status +
    audit events. Keyed by the unguessable id, never the reference.
- A signed, HttpOnly **order-access session cookie** (`ptm_order_access`) is set
  at checkout (and on successful lookup). **Cancellation requires that the
  session grants access to the target `public_access_id`** — a second factor on
  top of the unguessable id. Viewing status needs only the id.
- `create_checkout_order` now returns `{ orderRef, publicAccessId }` (was: bare
  `order_ref` text) so the trusted checkout path can establish the session
  without any reference→data read.
- `cancel_order_by_ref` is **dropped** and its `anon`/`authenticated` grant
  removed. `getOrderByRef` is removed from the codebase (no internal caller).

### Why session + unguessable id, not just one

- Unguessable id alone protects **viewing** (defeats enumeration) and is what the
  customer holds.
- Requiring the **session** for cancellation prevents a leaked URL (shoulder
  surf, shared link, browser history) from being used to cancel someone's order
  without re-proving identity (checkout device, or ref+phone lookup).

## Consequences

- Old `/order/[orderRef]` URLs no longer reveal data; they redirect to
  `/order/lookup` (ref+phone). No SMS contained a `/order/<ref>` deep link, so no
  customer link breaks.
- One contained, trusted service/anon path calls only safe RPCs. Public pages
  never import the service-role order repository.
- `ORDER_ACCESS_SECRET` is required to sign sessions. Missing in production →
  visible failure (no silent fallback). Development uses a clearly-marked
  insecure dev secret with a warning.

## Limitations / follow-ups (carried in V11.1 report)

- Email/SMS magic-link establishment is **not** implemented (spec lists it as
  optional "may"); ref+phone lookup is the implemented re-establishment path.
- Turnstile/CAPTCHA challenge after thresholds is **not** implemented; rate
  limiting (bounded counters) is.
- Rate-limit store is a Postgres table (correct for serverless multi-instance);
  a dedicated edge store is a future option.
