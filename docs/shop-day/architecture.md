# PTM Shop Day architecture

PTM is one operational product: the same shop, workflows, vocabulary and completion model for every user. Authority changes what a person may resolve; it must not create a second product.

## Canonical phase

`not_open → opening → trading → closing → closed`

The first implementation derives this phase from the existing persisted opening and closing sessions. It does not create a competing shop-day ledger. The branch-local business date comes from the authoritative branch timezone through `getBranchBusinessDate`, matching the SQL `branch_business_date` rule; it never comes from the browser or a UTC string slice.

## Existing sources of truth

| Concern | Existing authority |
| --- | --- |
| Opening and closing | `ops_checklist_sessions` plus append-only checklist events |
| Trading date | branch timezone through `getBranchBusinessDate` / SQL `branch_business_date` |
| Sales and refunds | `payment_events` and `refund_operations` |
| Till movements and variance | `till_events` and the closing completion metadata |
| Delivery and inventory truth | inventory batches, movements and delivery evidence |
| Interrupted work | persisted operator drafts and checklist sessions |
| Owner-only resolution | server-side staff authority and owner decision records |

## Frozen invariants

1. Trading actions are unavailable until opening completes and after closing starts.
2. Required opening and closing obligations cannot be bypassed by choosing Later.
3. Duplicate start/complete commands are idempotent.
4. Closing without a completed opening is inconsistent persisted state.
5. Every refusal includes a human instruction, not a software error.
6. Navigation is never operational truth.
7. Owner-only decision payloads are denied at the server query boundary, not hidden in React.
8. Irreversible business facts remain append-only and corrections use compensating events.
9. Refresh, browser restart and network interruption resume persisted work.
10. Shop closure has one answer: closed, or an explicit list of blockers.

## Implemented boundary

The shared `/operator` home consumes `PersistedShopDay` for both Dad and Uncle. Dad's owner role receives a server-authorised projection of the durable `owner_alerts` lifecycle; Uncle's manager render never runs that query. Sales, deliveries, waste and till movements are gated in the UI, in their server actions, and again inside guarded database writers. Starting the close and recording trading work share a branch/day transaction lock, while completed operation identities may still replay safely after a lost response.

`owner_alerts` remains the one persisted owner-work record. The owner presentation answers what happened, why it matters, what to do, and what happens if it is ignored; it does not create a second decision table.

## Next boundary

Move the remaining closing obligations into the same explicit gate projection, then certify one deterministic full day and the adversarial stale-tab/concurrent-close cases against the hosted system. Only after that human sign-off should the older admin navigation be buried further or analytics be added.
