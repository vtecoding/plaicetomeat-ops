# PTM Engineering Constitution

Months of audits turned PTM's architecture into principles: nothing bypasses the ledger,
the operator never sees scoring, the owner gets decisions not dashboards, one surface per
job, and so on. Those principles were already encoded as ~17 guard scripts — but they were
**fragmented and only run when someone remembered to.** This document is the operating
reference for making them **enforced**.

The constitution has three layers, by how honestly each can be mechanised:

| Layer | Question it answers | How it's enforced | Status |
|---|---|---|---|
| **A — Hard invariants** | "Did this break something that must never break?" | Deterministic guards, **fail CI** | ✅ Phase 1 (this doc) |
| **B — Complexity budget** | "Did this spend complexity without justifying it?" | Ratchet vs a committed budget file, **fail CI** unless the budget is updated | ⏳ Phase 2 |
| **C — Human judgement** | "Should this field/decision exist at all?" | Structured PR checklist, **never fails CI** | ⏳ Phase 3 |

The split is deliberate. A is binary and provable. B freezes the *complexity budget*, not the
implementation — you may spend complexity, but you must justify it. C is genuinely semantic;
forcing it into a deterministic gate would be cargo-cult engineering, so it stays in review.

---

## Phase 1 — The Spine (implemented)

`scripts/architecture-check.mjs` promotes the existing guard ecosystem into one runner with a
single PASS/FAIL verdict. **No scores, no percentages** — an invariant holds or it doesn't, and
when it breaks the report names what broke.

```
pnpm architecture:check          # static tier (default, CI-safe, no services)
pnpm architecture:check:all      # all tiers (local: needs Supabase + the app running)
node scripts/architecture-check.mjs --list    # print the articles
node scripts/architecture-check.mjs --tier=static,db
```

### The articles, by tier

Guards are tiered by dependency so the fast path needs nothing running. A guard outside the
selected tier is **SKIPPED** (reported, never failed).

**`static`** — pure source/migration scans (run in `quality.yml` on every PR):

| Principle | Invariant |
|---|---|
| Truth | ledger & truth-table RLS lock — nothing bypasses the ledger |
| Compliance | required temperature/compliance evidence is enforced |
| Decisions | owner decision surfaces stay action-only (`DO_NOW_MAX`, no metric panels) |
| Firewall | owner scoring internals never reach the UI |
| Firewall | the operator surface carries no ranking/analytics vocabulary |
| Convergence | one surface per job — no competing duplicate screens |
| Language | operator copy stays plain and jargon-free |
| Integrity | pricing validation is recomputed server-side, never client-trusted |

**`db`** — need a reachable Supabase (run in `database-security.yml`): disaster-recovery,
disaster-recovery-integrity.

**`live`** — drive the running app (run in `application-e2e.yml`): operator-route-lock,
operator-journeys, action-compression, today-os, one-tap-actions, morning-briefing,
customer-winback.

### Where it runs

- **`quality.yml`** runs the **static** tier on every PR and push to `main`. This is the gate
  that makes the static invariants un-bypassable.
- The `db` and `live` tiers are owned by the workflows that already stand up those
  dependencies; folding them into the same `architecture:check` registry is a follow-up so the
  whole constitution reports through one runner.

### Adding a guard

Add one entry to the `GUARDS` registry in `scripts/architecture-check.mjs` (`id`, `principle`,
`tier`, `script`, `what`). The registry is the single source of truth for what the constitution
enforces — keep it in sync with the `verify:*` scripts in `package.json`.

> **It already earned its keep.** Building the spine surfaced that the confirm-don't-ask PR had
> introduced ranking vocabulary (`confidence`) into the operator layer — a violation `quality.yml`
> would previously have sailed past. The guard caught it; the fix simplified the code. That is
> precisely the failure mode the spine exists to prevent: months of architectural work quietly
> undone by a later change nobody re-checked by hand.

---

## Phase 2 — Complexity Budget (planned)

`architecture-budget.json` records the spendable budget for the things you can't prove "should"
change but *can* count:

```json
{
  "operator": { "maxModes": 9, "maxRequiredInputs": 27, "maxScreensPerJourney": 6 },
  "owner":    { "maxTodayActions": 3, "maxNavigationDepth": 2, "maxAdminRoutes": 38 }
}
```

A check counts operator `Mode` union members, `admin/*` routes, owner-form inputs, etc., and
**fails the PR on an increase unless the budget file is updated in the same PR** — turning
"remember the philosophy" into "justify the regression." Every run also prints a complexity
delta (`Modes 8 → 8`, `Routes 38 → 38`) so creep is visible. No score; just change.

## Phase 3 — Semantic Review Checklist (planned)

A PR template encoding the questions a regex must never pretend to answer: *Does this field
duplicate something PTM already knows? Did we make the owner type instead of decide? Does this
new field have a downstream consumer?* These guide review; they do not gate CI.
