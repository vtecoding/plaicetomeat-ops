# PlaiceToMeat V11 Master Specification

## Consolidation, Security and Launch Hardening — “The Shop Operating System”

**Status:** Canonical implementation authority  
**Date:** 5 June 2026  
**Current baseline:** V10 Phase 2, commit `db32b338a983c60f42ef8a33581b644c44b0a72b`  
**Primary branch:** `main`  
**Product:** PlaiceToMeat Operations Platform  
**Audience:** Codex/Claude implementation agents, reviewers, future maintainers, Ismail, and the shop owner  
**Release character:** Consolidation and hardening release. Not a feature-expansion release.

---

# 1. Executive Summary

PlaiceToMeat has crossed the boundary from a storefront with admin pages into a genuine operational system. The strongest parts are no longer the dashboards. They are the workflows that guide a human through real shop activity:

- Today
- Opening
- Counter service
- Closing
- Stock count

Those surfaces are coherent, useful, and capable of becoming the operating rhythm of the shop. V11 must make them the centre of the product.

However, the source review found several security and correctness defects that are more serious than the existing audit pack reported. These invalidate any claim that the current build is ready for unrestricted public launch.

The most serious discovered defect is the customer order-access model. Human order references are sequential (`PTM-YYYY-NNNNN`), the public order page loads an order using the service-role client, and cancellation is authorised using only the order reference. An attacker able to enumerate references may discover customer names and purchases and may cancel incoming orders during the cancellation window. The audit pack described the public flow as a safe RPC with a restricted column subset; the source does not match that claim.

Other source-level defects include:

- authenticated staff can directly insert forgeable audit records;
- pickup capacity checks are vulnerable to concurrent oversubscription;
- checklist sessions can be completed without proving required steps were completed;
- arbitrary checklist step keys and payloads can be recorded;
- stock-count corrections can overwrite newer inventory changes because apply does not compare against the captured stock version;
- one dashboard waste query omits its branch filter while using a service-role client;
- demo data can silently replace real data across public and internal surfaces;
- checkout lacks abuse controls and permits duplicate product rows to bypass intended per-SKU quantity semantics;
- the intelligence stack repeatedly reloads overlapping data, allowing unnecessary latency and inconsistent “as of” moments;
- recovery, rollback, monitoring and production parity are not yet proven.

Therefore V11 has one mission:

> Make PlaiceToMeat safe, truthful, simple and recoverable enough to run a real shop without hidden failure modes.

V11 is not permitted to add speculative commercial features until the P0 security boundary, database invariants, recovery evidence and canonical owner workflow have been completed.

---

# 2. Evidence Base and Review Limits

This specification was produced from:

1. The 13-file full-system audit pack (`docs/full-audit-pack/00` through `12`).
2. The full repository ZIP at the V10 Phase 2 merge commit.
3. All 36 full-page screenshots and `_manifest.json`.
4. Static inspection of routes, server actions, server repositories, domain logic, migrations, permissions, tests, scripts and governance documents.

The screenshots confirmed 36/36 HTTP 200 renders against the locally built application and seeded local Supabase environment. They prove renderability, not security, concurrency correctness, mobile usability, production parity or disaster recovery.

The test suite was not independently re-run as part of this external review. Existing project records indicate a broad green suite, but those results do not discharge the newly identified adversarial cases. V11 must add executable tests for every security and integrity finding in this specification.

No environment secret values were used or reproduced. The supplied archive included ignored local/remote environment files and generated artefacts. V11 must introduce a sanitised export process so future review bundles never contain `.env*`, `.git`, `.next`, `node_modules`, `.vercel` or unrelated credentials.

---

# 3. Current-State Verdict

## 3.1 What is strong

- Server-side price recomputation prevents client price tampering.
- Order items snapshot names and prices, preserving historical truth.
- Checkout idempotency prevents accidental duplicate submission under the same key.
- Order status transitions are modelled explicitly rather than as arbitrary updates.
- Inventory movements and waste records provide a good ledger foundation.
- RLS, middleware, page checks and server-action checks form a strong defence-in-depth shape.
- Counter realtime has a polling fallback.
- Today, Opening, Closing and Stock Count represent the correct product direction.
- Domain intelligence is largely expressed as pure, testable logic.
- Audit and release concepts are more mature than in a typical small-business application.

## 3.2 What is not yet trustworthy

- A human-readable order reference is being used as an access credential.
- Append-only audit records are not necessarily authentic records.
- Several database rules depend on the UI behaving honestly rather than the database enforcing the invariant.
- Service-role reads bypass RLS and therefore amplify missing-filter mistakes.
- Data can be calculated from different moments during a single page load.
- Production can silently substitute demo data for failed real data.
- The release process and recovery path remain operationally fragile.

## 3.3 Revised readiness assessment

| Area | Verdict |
|---|---|
| Daily owner workflow | Strong foundation |
| Counter workflow | Strong foundation |
| Public order security | **Critical blocker** |
| Audit authenticity | **Critical blocker** |
| Checkout concurrency | **High risk** |
| Inventory reconciliation integrity | **High risk** |
| Checklist evidence integrity | **High risk** |
| Owner information architecture | Needs consolidation |
| Deployment/recovery | Not proven |
| Public launch | **Not approved** |

---

# 4. Goals

V11 must achieve all of the following:

1. Eliminate unauthorised public order viewing and cancellation.
2. Make database invariants authoritative rather than trusting the UI.
3. Make audit records append-only **and** authentic.
4. Prevent oversold pickup capacity under concurrency.
5. Prevent stale stock-count corrections from overwriting newer stock truth.
6. Remove silent demo-data substitution in production.
7. Establish Today as the one canonical owner home.
8. Reduce duplicate pages, labels, calculations and data reads.
9. Bind every intelligence result to a coherent branch and `asOf` snapshot.
10. Make “no data”, “zero”, “stale”, “estimated” and “failed to load” visibly different states.
11. Make production deployment, rollback, restore and health verification repeatable.
12. Produce executable evidence that the system withstands adversarial input, concurrency and partial failure.
13. Preserve the simple, guided nature of the best V10 workflows.
14. Keep the launch model realistic for one small butcher shop and one primary branch.

---

# 5. Non-Goals

V11 must not attempt to add the following unless needed to close a P0/P1 invariant:

- online card payments;
- customer accounts or loyalty schemes;
- multi-branch public routing;
- WhatsApp commerce;
- Qurbani workflows;
- supplier scoring or automated purchase orders;
- advanced forecasting or machine learning;
- automatic carcass optimisation;
- naive sales-to-batch stock depletion;
- complex offline-first synchronization;
- a dashboard redesign performed before security and data integrity work;
- a new analytics engine added alongside existing engines;
- broad visual rebranding;
- speculative AI features.

These may be reconsidered after V11 release evidence exists.

---

# 6. Non-Negotiable System Invariants

The following invariants are release requirements, not preferences.

## 6.1 Public order invariants

- A sequential order reference must never authorise data access.
- A public user must not retrieve an order using only `order_ref`.
- A public user must not cancel an order using only `order_ref`.
- Public status responses must contain only a documented safe DTO.
- Customer phone, email, internal notes, staff notes, raw IDs, SMS error details and branch-internal metadata must never appear in a public response.
- Public lookup, access establishment and cancellation must be rate-limited.
- Cancellation must lock the target order and re-check its status inside the same transaction.
- A cancellation racing with a staff transition must produce one valid winner, never a clobbered state.

## 6.2 Checkout invariants

- Product prices and availability are read only from the database at commit time.
- Duplicate product IDs in a submitted basket are rejected or atomically aggregated before validation.
- Per-SKU maximum quantity applies to the aggregate quantity, not each duplicate row.
- Basket line count and request body size are bounded.
- Per-window and per-day capacity are enforced atomically under concurrency.
- Idempotency scope is explicit and cannot return another branch’s order.
- Business validation errors have stable machine codes, not only text fragments.
- Branch timezone is the only source of “today” and cutoff semantics.

## 6.3 Audit invariants

- Client roles may not insert directly into canonical audit tables.
- Actor identity, actor role, branch and event time are derived by trusted server/database code.
- A caller cannot claim to be another actor.
- Canonical audit rows cannot be updated or deleted through application roles.
- Every material write either creates its audit evidence in the same transaction or fails entirely.
- Audit history must distinguish system, public customer, staff, manager and owner actions.

## 6.4 Checklist invariants

- Every session is bound to an immutable checklist definition version and checksum.
- Only registered step keys may be recorded.
- Payloads are validated for their step type.
- Completion is impossible unless all required steps have a valid latest outcome.
- Critical safety steps cannot be silently skipped.
- A skip or not-applicable result requiring a reason must include one.
- Completion receipts are generated from persisted server state, never client claims.

## 6.5 Inventory invariants

- Every stock mutation produces a ledger movement and audit event in the same transaction.
- Remaining stock cannot be negative or exceed received stock.
- A stock-count line captures a batch version.
- Applying a count is compare-and-swap: if the batch changed after counting, apply fails and requires recount/rebase.
- A completed stock-count session cannot contain unapplied lines unless the completion state explicitly records and explains them.
- Branch A analytics can never include Branch B stock or waste.

## 6.6 Intelligence invariants

- One owner page request uses one immutable operational snapshot.
- Every result carries `branchId`, `asOf`, data-source health and completeness.
- Missing data is not represented as zero.
- Stale data is not presented as current.
- Estimated values are visually and structurally distinct from reconciled values.
- Today, Briefing and Advanced Insights may not independently compute conflicting versions of the same fact.

## 6.7 Production invariants

- Production never returns demo products, demo orders, demo settings or demo intelligence on a real-data failure.
- Production may enter a visible degraded state, but not a plausible fake state.
- Production cannot deploy while test users, known bootstrap credentials or migration drift are detected.
- Every release has a commit SHA, migration set, verification receipt and rollback reference.
- A restore drill must prove that a known backup can become a usable environment.

---

# 7. Target Architecture

V11 must converge on the following dependency direction:

```text
UI / Routes
    ↓
Application Use Cases
    ↓
Domain Policies and Pure Intelligence
    ↓
Repository Interfaces
    ↓
Supabase/Postgres and External Adapters
```

Dependencies may point downward only. Pages must not know database table shapes. Domain logic must not instantiate Supabase clients. External adapters must not decide business policy.

## 7.1 Presentation layer

Responsibilities:

- render safe view models;
- collect validated user intent;
- show explicit loading, degraded, empty, stale and failure states;
- never provide the only enforcement of a business invariant.

## 7.2 Application layer

Introduce explicit use cases for material operations, for example:

- `PlaceOrder`
- `EstablishPublicOrderAccess`
- `GetPublicOrderStatus`
- `CancelCustomerOrder`
- `TransitionOrderStatus`
- `StartChecklistSession`
- `RecordChecklistStep`
- `CompleteChecklistSession`
- `RecordStockCount`
- `ApplyStockCountCorrection`
- `LoadOperationalSnapshot`

Each use case owns orchestration, authorization, transaction expectations, typed errors and observability.

## 7.3 Domain layer

Keep pure logic for:

- cancellation eligibility;
- order transition rules;
- pickup availability policy;
- inventory reconciliation policy;
- purchasing calculations;
- margin and yield calculations;
- owner-decision prioritisation;
- data-quality classification.

Domain functions must receive immutable inputs and return deterministic outputs.

## 7.4 Repository layer

Create narrowly scoped repositories. Suggested shape:

```text
src/lib/repositories/
  orders-repository.ts
  public-order-access-repository.ts
  inventory-repository.ts
  checklist-repository.ts
  operational-snapshot-repository.ts
  audit-repository.ts
```

Rules:

- repositories require an explicit branch where branch scope applies;
- public repositories return public DTOs only;
- the service-role client is not imported by public pages or generic domain modules;
- no unscoped `select` is allowed in a branch-scoped repository;
- every repository operation returns typed failures and source health;
- read models may be optimised, but must not become a second source of write truth.

## 7.5 Database layer

Postgres remains the final authority for:

- authorization at the data boundary;
- transactionality;
- uniqueness;
- concurrency control;
- status transitions;
- capacity;
- checklist completion;
- stock compare-and-swap;
- canonical audit creation.

The database must reject forged or incomplete operations even when an attacker calls an RPC directly.

---

# 8. V11 Implementation Programme

## Phase V11.0 — Baseline Freeze and Reproducibility

### Purpose

Prevent V11 work from being performed against an uncertain production state.

### Requirements

1. Tag the V10 baseline commit.
2. Record every migration filename and checksum.
3. Compare local, preview and production migration sets.
4. Export a schema-only snapshot.
5. Record production project identifiers without storing secrets in the repository.
6. Produce a sanitized review bundle script.
7. Run and archive the current full test suite before changing code.
8. Add a temporary release freeze: no non-P0 feature work until V11.1 passes.

### Sanitized bundle command

Add a command such as:

```bash
npm run audit:bundle
```

It must include tracked source, migrations, tests and docs only. It must exclude at minimum:

```text
.env*
.git/
.next/
node_modules/
.vercel/
coverage/
playwright-report/
test-results/
local screenshots containing PII
```

The command must fail if a secret scanner detects credentials.

### Acceptance

- Worktree clean.
- Baseline tag exists.
- Test report archived.
- Production migration parity recorded.
- Sanitized bundle contains no secret-bearing files.

---

## Phase V11.1 — Emergency Public Security Boundary

This phase is mandatory before public launch.

### 8.1.1 Replace order-reference authorization

Current human references are sequential and must be treated as labels only.

Add:

```sql
orders.public_access_id uuid not null default gen_random_uuid() unique
orders.public_access_revoked_at timestamptz null
orders.public_access_version integer not null default 1
```

Recommended access model:

- status route becomes `/order/status/[publicAccessId]`;
- `publicAccessId` is random and unguessable;
- checkout establishes a signed, HttpOnly order-access session;
- a returning customer may establish access using `order_ref + full normalized phone`, subject to rate limits;
- public status uses a dedicated safe DTO;
- cancellation requires an established order-access session;
- SMS/email magic links may establish the same session later;
- the human `order_ref` is displayed but is never sufficient for access.

The public DTO may include:

```ts
export type PublicOrderStatus = {
  orderRef: string;
  customerDisplayName: string; // masked or first name only
  status: "incoming" | "prepping" | "ready" | "collected" | "cancelled";
  pickupDate: string;
  pickupWindowLabel: string;
  items: Array<{
    name: string;
    quantity: number;
    unitType: "kg" | "each" | "box";
    lineTotal: number;
  }>;
  subtotal: number;
  canCancel: boolean;
  cancellationDeadline: string | null;
};
```

It must not include phone, email, raw order ID, branch internals, notes, staff notes or SMS diagnostics.

### 8.1.2 Cancellation transaction

Replace `cancel_order_by_ref` with an authenticated public-access operation.

Inside one transaction:

1. resolve the established public access;
2. `SELECT ... FOR UPDATE` the order;
3. verify current status is `incoming`;
4. verify deadline using branch timezone/configuration;
5. perform a conditional status transition;
6. insert status event;
7. insert canonical audit event;
8. return a safe result.

No stale pre-read may be used to overwrite a newer staff transition.

### 8.1.3 Rate limiting and abuse control

Rate-limit:

- public access establishment;
- public status reads;
- cancellation attempts;
- checkout submissions.

Use combined keys where lawful and practical:

- IP/network signal;
- normalized phone hash;
- order reference hash;
- branch;
- time window.

Requirements:

- bounded counters and retention;
- no plaintext phone in rate-limit logs;
- stable `429` responses;
- emergency kill switch;
- challenge/Turnstile only after suspicious thresholds, not necessarily on every customer.

### 8.1.4 Checkout spam protection

Add safeguards against fake-order slot exhaustion:

- maximum active orders per normalized phone over a configurable period;
- IP/phone submission throttles;
- body-size limit;
- basket-line limit;
- optional challenge after repeated attempts;
- operational alert for sudden rejection spikes.

### 8.1.5 Security headers

Add and test:

- Content-Security-Policy;
- `frame-ancestors 'none'` or equivalent `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- Referrer-Policy;
- Permissions-Policy;
- HSTS in production;
- strict cookie attributes (`HttpOnly`, `Secure`, suitable `SameSite`, bounded max-age).

CSP must be compatible with Supabase and required assets without falling back to broad unsafe directives.

### 8.1.6 Security tests

Mandatory adversarial tests:

- enumerate 10,000 plausible order references and retrieve zero order data;
- cancel without an access session and receive no state change;
- access one order using another order’s session and fail;
- race staff “start prep” against customer cancellation and prove a valid single outcome;
- brute-force access attempts trigger rate limiting;
- public DTO snapshot contains no forbidden fields;
- public route dependency graph cannot import the unrestricted service-role order repository.

### V11.1 exit gate

No public launch until every security test passes and the old reference-only routes/RPC grants are removed or made permanently non-authoritative.

---

## Phase V11.2 — Audit Authenticity and Privileged Data Access

### 8.2.1 Remove client audit insertion

Revoke direct insert privileges and policies for authenticated users on canonical audit tables.

Canonical audit insertion must occur only through:

- trusted database triggers;
- trusted SECURITY DEFINER functions not granted as arbitrary event writers;
- tightly scoped server-side operations.

Actor properties must be derived from `auth.uid()` and the current profile, never accepted from the caller.

### 8.2.2 Canonical audit schema

Rationalise `audit_logs` and `audit_events`. One table must be canonical. The other may be a read projection, but not an independently writable competing history.

Minimum canonical fields:

```text
id
occurred_at
branch_id
actor_kind
actor_user_id
actor_role
source
request_id
correlation_id
event_type
entity_type
entity_id
before_summary
after_summary
metadata
idempotency_key
schema_version
```

Optional stronger integrity:

- previous event hash per branch;
- row hash over canonical fields;
- periodic export to an external immutable sink.

A hash chain is not a substitute for correct authorization, but may strengthen later evidence.

### 8.2.3 Service-role containment

Introduce a hard rule:

> Service-role access is an infrastructure capability, not a general data-fetching convenience.

Requirements:

- no direct service-role import from public pages;
- no generic `getOrderByRef` returning the full internal `Order` to a public route;
- all branch-scoped service-role queries require an explicit branch predicate;
- owner-only global queries must be named as global;
- add static checks or architecture tests for forbidden imports;
- add cross-branch tests for every analytics repository.

### 8.2.4 Fix known branch leak

The weekly waste count in `getDashboardMetrics` must be branch-filtered. Add a regression test with two branches proving that one branch’s dashboard never includes the other branch’s waste.

### V11.2 exit gate

- Direct client insert into audit tables fails.
- Forged actor metadata is impossible.
- Cross-branch analytics tests pass.
- Public routes contain no unrestricted internal order reads.

---

## Phase V11.3 — Checkout and Capacity Correctness

### 8.3.1 Duplicate SKU handling

At both TypeScript and SQL boundaries:

- reject duplicate `productId` entries or aggregate them before validation;
- enforce the maximum on the aggregate quantity;
- enforce a maximum number of distinct basket lines;
- reject non-finite numeric values and excessive precision;
- preserve server-side price authority.

The database must independently detect duplicates even if the API validation is bypassed.

### 8.3.2 Atomic pickup capacity

The current count-then-insert sequence is race-prone.

Use one of these approved implementations:

1. transaction-scoped advisory lock keyed by `(branch, pickup_date, pickup_window)` followed by count and insert; or
2. a capacity reservation row updated atomically with a bounded condition.

The chosen design must also enforce `max_orders_per_day`, or the setting must be removed. A control displayed in settings but ignored by checkout is prohibited.

Cancellation must release capacity under the same model if counters/reservations are materialised.

### 8.3.3 Stable error contract

Replace string-fragment parsing with codes:

```ts
export type CheckoutErrorCode =
  | "INVALID_REQUEST"
  | "BRANCH_UNAVAILABLE"
  | "WINDOW_UNAVAILABLE"
  | "WINDOW_FULL"
  | "DAY_FULL"
  | "SHOP_CLOSED"
  | "SAME_DAY_CUTOFF_PASSED"
  | "PRODUCT_UNAVAILABLE"
  | "QUANTITY_INVALID"
  | "MINIMUM_ORDER_NOT_MET"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";
```

Public messages remain friendly; telemetry records the code and correlation ID.

### 8.3.4 Branch-time authority

All date/cutoff logic must use the configured branch timezone. Remove hard-coded “4pm” wording when cutoff is configurable. The database or one shared branch-time service must return the authoritative deadline and message parameters.

### 8.3.5 Concurrency tests

- 50 simultaneous attempts against a window with capacity 5 produce exactly 5 active orders.
- 50 simultaneous attempts against a daily cap produce no excess.
- same idempotency key produces one order.
- distinct idempotency keys are not incorrectly collapsed.
- cancellation racing checkout/capacity update leaves counters consistent.

---

## Phase V11.4 — Checklist and Operational Evidence Integrity

### 8.4.1 Versioned checklist definitions

Add immutable definitions:

```text
ops_checklist_definitions
  id
  kind
  version
  checksum
  active_from
  retired_at

ops_checklist_definition_steps
  definition_id
  step_key
  position
  label
  step_type
  required
  critical
  allow_skip
  allow_na
  reason_required_on_skip
  payload_schema_version
```

Each session records `definition_id`, `definition_version` and `definition_checksum`.

### 8.4.2 Step validation

`ops_record_step` must reject:

- unknown step key;
- step key from another checklist kind/version;
- invalid state for that step;
- missing skip reason where required;
- malformed or unexpected payload;
- out-of-range temperature;
- duplicate conflicting event under the same idempotency key.

Append-only events remain useful, but the “latest effective event per step” must be deterministic.

### 8.4.3 Completion validation

`ops_complete_session` must derive completion from persisted events.

It must reject:

- missing required steps;
- critical steps skipped without approved override;
- stock-count sessions with unresolved stale lines;
- stock-count sessions with required active batches not accounted for, unless explicitly excluded with reason;
- a session definition mismatch.

### 8.4.4 Operations history

Add one read-only history surface:

```text
/admin/operations-history
```

It must support:

- date range;
- opening/closing/stock-count kind;
- completed/incomplete/exception status;
- actor;
- step outcomes;
- temperatures;
- skip reasons;
- stock corrections;
- receipt/export view.

This is evidence review, not another dashboard.

### 8.4.5 Merge temperature capture

Opening/closing temperature steps must write to the same canonical compliance reading model used by daily food-safety checks. No duplicate manual entry and no competing “official” records.

### V11.4 exit gate

A direct RPC caller cannot complete an empty checklist, invent a step key or forge a valid receipt.

---

## Phase V11.5 — Inventory Reconciliation Integrity

### 8.5.1 Launch inventory model decision

For the initial shop, use **periodic reconciliation mode** rather than implementing naive sales-to-batch depletion.

Reason:

- meat may be cut from shared batches;
- sold units do not reliably identify the physical source batch;
- variable-weight products complicate exact automatic depletion;
- pretending to know the batch is worse than explicitly reconciling.

Add a branch setting:

```text
inventory_accuracy_mode = 'periodic_reconciliation'
```

Owner-facing inventory must show:

- last reconciled time;
- who reconciled it;
- age of the stock snapshot;
- “estimated since last count” where relevant;
- missing/waste-not-recorded warnings.

Do not call the value “live stock” unless transactional depletion is later implemented correctly.

### 8.5.2 Batch versioning

Add `inventory_batches.version bigint not null default 0` or an equivalent monotonic movement sequence.

Every stock mutation increments the version in the same transaction.

A stock-count line records:

```text
batch_version_at_count
system_weight_at_count
counted_weight
counted_at
```

Apply must lock the batch and compare current version with `batch_version_at_count`.

If they differ:

- return `STOCK_COUNT_STALE`;
- do not change stock;
- show the intervening movement(s);
- require recount or explicit rebase.

### 8.5.3 One correction door

Canonical normal correction flow:

```text
Close → Stock Count → Review difference → Apply audited correction
```

The general inventory screen must not offer an equally prominent competing adjustment path.

An emergency manager correction may remain, but it must:

- be clearly labelled exceptional;
- require a reason;
- show before/after;
- create movement and audit evidence;
- invalidate any open count using that batch.

### 8.5.4 Zero vs not recorded

Represent separately:

- zero waste confirmed;
- no waste entry submitted;
- waste data failed to load;
- stock count not due;
- stock count overdue;
- count in progress;
- count stale.

### 8.5.5 Future transactional depletion

Transactional sales depletion is deferred until a real allocation model is proven. A future design must define:

- product-to-batch allocation;
- FEFO/FIFO policy;
- variable-weight confirmation;
- substitutions;
- cancelled/returned order reversal;
- carcass-to-cut provenance;
- oversell policy;
- manual override and reconciliation.

No V11 agent may add a simplistic `order collected → subtract product quantity from arbitrary batch` implementation.

---

## Phase V11.6 — Canonical Owner Operating System

### 8.6.1 One owner home

`/admin/today` becomes the only canonical daily home.

It must answer:

1. Is the shop ready to open?
2. What needs attention now?
3. What is happening during service?
4. What must be completed before closing?
5. Is the data current enough to trust?

### 8.6.2 Route disposition

| Current surface | V11 disposition |
|---|---|
| `/admin/today` | Keep; canonical home |
| `/admin/today/walk` | Keep; guided mode using same data |
| `/admin/today/[id]` | Keep; one decision detail |
| `/admin/open` | Keep; integrate official compliance capture |
| `/admin/close` | Keep; orchestrate waste/count hand-offs |
| `/admin/stock-count` | Keep; canonical normal correction flow |
| `/counter` | Keep; canonical service surface |
| `/admin/briefing` | Retire or redirect to Today insights |
| `/admin` | Rename/reposition as Advanced Insights |
| `/admin?mode=counter` | Remove; `/counter` already owns service |
| `/admin/orders` | Keep but label “Order history” |
| `/admin/compliance` | Rename “Supplier certificates” |
| `/counter/compliance` | Rename “Daily food-safety checks” |
| `/admin/inventory` | Keep for intake, batch review and exceptions; remove normal correction duplication |

### 8.6.3 Navigation hierarchy

Primary owner navigation:

```text
Today
Counter
Tools
```

Today contains task links for:

- Start/Resume Opening
- Current service status
- Urgent decisions
- Close the shop
- Stock count due
- Weekly plan

Tools contains:

- Order history
- Products & prices
- Inventory intake and batch review
- Purchasing
- Supplier certificates
- Collection times
- Closed days
- Operations history
- Advanced insights
- System checks (owner only)
- Activity history (owner only)

Do not expose several pages with competing answers to “How is the shop today?”

### 8.6.4 Progressive disclosure

Default owner cards must show:

- one fact;
- why it matters;
- what to do next;
- data freshness;
- estimated time.

Advanced calculations remain one tap deeper. The owner should not need to interpret implementation terms such as “batch movement”, “RPC”, “realtime mode”, “yield variance engine” or “data completeness score” unless viewing an advanced explanation.

### 8.6.5 Responsive proof

The current 36-image pack is desktop-only. V11 requires visual and functional regression at minimum:

- 390×844 owner phone;
- 768×1024 counter/tablet portrait;
- 1024×768 counter/tablet landscape;
- 1366×900 desktop.

Counter buttons must be usable with gloves/large touch targets where practical. Opening/closing must work comfortably on a phone.

---

## Phase V11.7 — One Operational Snapshot, Many Views

### 8.7.1 Current problem

The current intelligence path repeatedly loads overlapping datasets through `getOwnerBrain`, `getShopIntelligence`, `getDashboardMetrics`, `getOperationsIntelligence` and `getPurchasingPlan`. This creates redundant database traffic and permits one page to combine facts captured at different moments.

### 8.7.2 Canonical snapshot

Introduce:

```ts
export type OperationalSnapshot = {
  branchId: string;
  asOf: string;
  source: "live" | "degraded";
  sourceHealth: {
    database: "healthy" | "degraded" | "unavailable";
    realtime: "healthy" | "polling" | "stale" | "unavailable";
    sms: "enabled" | "test" | "degraded" | "disabled";
  };
  completeness: {
    orders: "complete" | "partial" | "missing";
    inventory: "reconciled" | "estimated" | "missing";
    waste: "confirmed_zero" | "recorded" | "not_recorded" | "missing";
    productCosts: "complete" | "partial" | "missing";
    compliance: "complete" | "partial" | "missing";
  };
  orders: ReadonlyArray<OrderSnapshot>;
  inventory: ReadonlyArray<InventoryBatchSnapshot>;
  waste: ReadonlyArray<WasteSnapshot>;
  products: ReadonlyArray<ProductCostSnapshot>;
  suppliers: ReadonlyArray<SupplierComplianceSnapshot>;
  operations: OperationsCaptureSnapshot;
};
```

A single repository call loads this snapshot per request. Pure functions then derive:

- Today decisions;
- Advanced Insights;
- purchasing suggestions;
- waste intelligence;
- margin intelligence;
- launch/operations health.

### 8.7.3 Snapshot guarantees

- all branch-scoped inputs share one branch;
- all time calculations use one `asOf` and branch timezone;
- data reads are deduplicated;
- degraded inputs remain explicit;
- computations do not perform hidden database calls;
- request-level caching is allowed, global stale caching is not unless TTL/invalidation are explicit.

### 8.7.4 Consolidate intelligence vocabulary

Keep one canonical decision model. “Owner Brain”, “Shop Intelligence” and “Operations Intelligence” may remain internal module names temporarily, but public concepts must converge.

Recommended internal target:

```text
OperationalSnapshot
  → deriveOperationalFacts
  → deriveOwnerDecisions
  → deriveAdvancedInsights
```

No page-specific engine may independently recompute the same business fact.

---

## Phase V11.8 — Pricing and Cost Truth

### 8.8.1 Butcher validation gate

No recommended selling price derived from yield assumptions may be presented as authoritative until:

- a competent butcher reviews the cut-sheet assumptions;
- representative carcass/cut trials are recorded;
- variance is compared against modelled yield;
- the source and date of approval are stored.

### 8.8.2 Cost provenance

Add a versioned cost record or equivalent history:

```text
product_cost_versions
  id
  branch_id
  product_id
  cost_per_kg
  source_type        // manual, supplier, carcass, cutting_guide, reconciled
  source_entity_id
  effective_at
  recorded_at
  recorded_by
  approved_by
  confidence         // verified, provisional, estimated
  note
```

The active product cost may remain denormalised for fast reads, but every change must have provenance.

### 8.8.3 UI language

Show:

- Verified cost
- Provisional estimate
- Last updated
- Source
- Margin unavailable

Never silently substitute a fabricated cost. Never show a precise margin percentage when the input cost is missing or provisional without a visible caveat.

### 8.8.4 One price commit path

Products and Cutting Guide may both navigate to pricing, but one application use case must own the commit. It records:

- old price;
- new price;
- cost source/version;
- margin before/after;
- actor;
- reason;
- effective time.

---

## Phase V11.9 — Production Failure Semantics

### 8.9.1 Remove silent demo fallback

Production behaviour:

```text
real data succeeds     → render real data
real data partially fails → explicit degraded state
real data unavailable  → fail visibly and alert
```

Demo data is permitted only when all are true:

- environment is development/preview;
- `DEMO_MODE=true` is explicit;
- a visible “Demo data” marker is rendered;
- writes are disabled or isolated.

It must never activate merely because a query returned an error or an empty result.

### 8.9.2 Typed result states

Repositories should return explicit result types:

```ts
type DataResult<T> =
  | { kind: "ok"; data: T; asOf: string }
  | { kind: "empty"; data: T; asOf: string }
  | { kind: "degraded"; data: T | null; reason: string; asOf: string }
  | { kind: "unavailable"; reason: string; correlationId: string };
```

An empty catalogue is not a database failure. Zero waste is not missing waste capture. A stale counter is not a healthy counter with an old timestamp.

### 8.9.3 Bounded retry policy

- Retry only idempotent operations.
- Use bounded attempts and jitter.
- Never retry validation errors.
- Never create a second order after an ambiguous timeout without reusing the same idempotency key.
- Surface final failure with a correlation ID and a safe manual fallback.

---

# 9. Observability

## 9.1 Structured events

At minimum emit structured events for:

- checkout accepted/rejected/failed;
- public order-access accepted/rejected/rate-limited;
- customer cancellation accepted/rejected/raced;
- order transition;
- realtime connected/degraded/recovered;
- SMS attempted/failed/retried;
- checklist started/step/completed/rejected;
- stock count stale/apply/correction;
- audit write failure;
- migration mismatch;
- demo-mode activation;
- operational snapshot degraded;
- deployment verification.

Each event includes:

```text
request_id
correlation_id
branch_id where applicable
actor_kind
operation
result
error_code
duration_ms
release_sha
```

Do not log full phone numbers, emails, notes, order contents or access secrets.

## 9.2 Alerts

Minimum alerts:

- checkout internal-error rate above threshold;
- repeated public access/cancel abuse;
- any production demo-mode attempt;
- migration drift;
- database unavailable;
- counter stale beyond threshold during opening hours;
- SMS failure requiring staff call;
- missing opening/closing evidence after configured deadline;
- certificate expiry threshold;
- backup/restore verification failure.

## 9.3 Customer-impact visibility

A failed “ready” SMS must appear directly on the relevant order row/card with:

- “Text failed”;
- failure timestamp;
- “Call customer” action;
- retry state if retry is safe.

Do not bury the only indication in an aggregate dashboard tile.

## 9.4 Initial SLOs

These are operating targets, not marketing claims:

| Measure | Initial target |
|---|---|
| Checkout technical success | ≥99.5% excluding validation/rate limits |
| Checkout p95 server latency | <1.5 seconds under expected load |
| Counter realtime freshness | <3 seconds when healthy |
| Counter polling freshness | ≤20 seconds when degraded |
| Silent fallback incidents | 0 |
| Cross-branch leakage incidents | 0 |
| Unauthorised order access/cancel | 0 |
| Audit write coverage for material mutations | 100% |
| Restore drill success | 100% of scheduled drills |

---

# 10. Reliability, Deployment and Recovery

## 10.1 Deployment pipeline

A release must execute in this order:

1. typecheck;
2. lint/format;
3. unit tests;
4. database contract/invariant tests;
5. security/adversarial tests;
6. build;
7. Playwright role and workflow matrix;
8. migration drift check;
9. preview smoke;
10. controlled production migration;
11. production deploy;
12. production read-only verification;
13. release receipt/certification.

A failed stage blocks later stages.

## 10.2 Migration strategy

Use expand–migrate–contract:

- add new columns/tables in a backward-compatible migration;
- deploy code capable of reading old/new where required;
- backfill with verifiable counts;
- switch writes;
- verify;
- remove old path only in a later release.

Every migration must declare:

- expected row impact;
- lock risk;
- rollback/forward-fix strategy;
- verification query;
- data retention effect.

## 10.3 Backup and restore

Before launch, document and prove:

- backup/PITR availability;
- retention period;
- who can restore;
- recovery time objective;
- recovery point objective;
- restore into an isolated environment;
- application smoke against restored data;
- credential rotation after compromise.

A backup is not considered proven until restoration succeeds.

## 10.4 Rollback runbook

The runbook must cover:

- front-end rollback to known-good deployment;
- incompatible schema migration response;
- forward-fix path where down migration is unsafe;
- disabling checkout while preserving counter access;
- disabling SMS;
- switching counter to polling;
- manual order capture during outage;
- reconciliation of manually captured orders after recovery.

## 10.5 Shop continuity mode

Prepare a one-page manual contingency:

- record order reference/customer phone/pickup/items on paper or approved offline template;
- mark status manually;
- do not promise SMS during outage;
- reconcile orders and stock after service;
- identify who decides when the online shop is temporarily closed.

V11 does not need a full offline-first application, but the business must know what to do when technology fails.

---

# 11. Security and Privacy Hardening

## 11.1 Production identity hygiene

Release gate must fail when:

- known `*.test` users exist;
- a bootstrap/developer owner account remains unexpectedly active;
- default credentials are detected;
- inactive users retain active sessions beyond policy;
- branch B seed data exists in production without an explicit reason.

Rotate/revoke any remote tokens or credentials included in unsanitised archives shared outside a trusted boundary.

## 11.2 Login protections

Improve the current email-only throttling with:

- per-email and per-IP/network controls;
- bounded lockouts;
- telemetry for lockout abuse;
- no fail-open behaviour on throttle-storage failure without an alert;
- secure password reset URL verification;
- owner recovery procedure.

Avoid making a known owner email trivially denial-of-serviceable through repeated lockout attempts.

## 11.3 PII discipline

- Minimise customer PII returned to UI.
- Apply retention rules for customer phone/email/order notes.
- Keep PII out of analytics metadata and general logs.
- Restrict exports.
- Document who can access customer data and why.
- Obtain an appropriate UK privacy/legal review before public launch; the current brief privacy page should not be assumed sufficient merely because it renders.

## 11.4 RLS and authorization matrix

Maintain executable tests for:

- anon;
- staff branch A;
- manager branch A;
- staff/manager branch B;
- inactive user;
- owner;
- service role only where explicitly intended.

Test read and write denial, not only route redirects.

---

# 12. Failure-Mode Register

| Failure | Required behaviour |
|---|---|
| Supabase unavailable | No demo substitution; public shop shows controlled unavailability; counter shows degraded state/manual process |
| Public order reference guessed | No data returned; no observable distinction useful for enumeration |
| Customer cancellation races staff prep | Row lock/conditional transition yields one valid result |
| Two customers take last pickup slot | Atomic capacity permits only one |
| Duplicate SKU rows submitted | Rejected or aggregated before max validation |
| Staff forges audit insert | Database denies direct insert |
| UI completes empty checklist | Database rejects completion |
| Unknown checklist step submitted | Database rejects it |
| Stock changes after count but before apply | Apply fails stale; no overwrite |
| Branch B waste exists | Branch A dashboard remains unchanged |
| SMS fails | Order still transitions; staff sees failure on order and calls customer |
| Realtime fails | Polling activates; visible degraded indicator |
| Migration missing in production | Deployment blocked |
| New release breaks checkout | Health gate fails and known-good frontend is restored |
| Database accidentally modified | PITR/backup restore runbook used and verified |
| Owner loses account access | Controlled recovery process; no permanent developer backdoor |
| No waste logged | UI says “not recorded”, not “£0 waste” |
| Cost missing/provisional | Margin withheld or clearly labelled provisional |
| Query partially fails | Snapshot marked partial/degraded; affected insight suppressed |
| Archive prepared for review | Secret scanner and allowlist prevent env/generated files entering bundle |

---

# 13. Validation Strategy

## 13.1 Test pyramid

### Unit

- pure business policies;
- DTO mapping;
- data-quality states;
- owner decision derivation;
- branch-time calculations;
- price/cost provenance;
- input deduplication.

### Database integration

- RLS matrix;
- status transitions;
- cancellation authorization and lock;
- capacity concurrency;
- audit insert denial;
- checklist definition/completion;
- stock-count compare-and-swap;
- cross-branch isolation;
- idempotency.

### Application integration

- use cases with repository adapters;
- degraded repository states;
- external SMS failure;
- correlation IDs and audit coupling.

### End-to-end

- public browse → checkout → secure status → cancellation;
- staff counter lifecycle;
- owner opening → Today → closing → stock count;
- role access matrix;
- mobile/tablet/desktop.

### Adversarial

- order enumeration;
- forged public cancellation;
- forged audit events;
- duplicate basket lines;
- oversized payloads;
- rate-limit bypass attempts;
- cross-branch swaps;
- stale stock-count apply;
- incomplete checklist completion;
- production fallback simulation;
- concurrent final-slot attempts.

## 13.2 Mutation and invariant tests

Critical rules should have tests that fail when the rule is deliberately removed. At minimum:

- public authorization does not depend on order reference;
- audit actor cannot be caller supplied;
- capacity cannot exceed maximum;
- completed checklist implies complete required evidence;
- applied stock count implies batch version matched;
- every branch-scoped analytics query is branch constrained;
- production demo mode is impossible without explicit configuration.

## 13.3 Performance/load

Load profile should reflect a small shop but still exercise races:

- 50 concurrent checkout requests;
- 100 concurrent public status reads;
- repeated counter polling/realtime reconnect;
- Today page snapshot under representative data growth;
- audit/history pagination with at least one year of synthetic events.

The goal is not internet-scale vanity. It is deterministic behaviour under bursts and failure.

## 13.4 Production proof

Before launch archive evidence for:

- production schema parity;
- public security matrix;
- real checkout smoke with controlled data;
- order status access denial without authorization;
- cancellation path;
- counter transition;
- opening/closing evidence;
- restore drill;
- rollback drill;
- no test accounts;
- no demo fallback;
- responsive captures;
- security headers.

---

# 14. Release Gates

## Gate A — P0 Security

Must all pass:

- order references no longer authorise access;
- unauthorised cancellation impossible;
- public endpoints rate-limited;
- audit direct insertion revoked;
- service-role public read removed;
- security headers verified.

## Gate B — Data Integrity

- atomic capacity passes concurrency test;
- duplicate SKU bypass closed;
- daily cap enforced or removed;
- checklist completion invariant enforced;
- stale stock-count apply blocked;
- branch analytics isolation passes.

## Gate C — Production Truth

- no production demo fallback;
- migration parity exact;
- test/bootstrap users absent;
- secrets/archive hygiene clean;
- cost/yield assumptions labelled and signed off appropriately.

## Gate D — Operability

- Today is canonical;
- Briefing duplication removed/redirected;
- normal stock correction has one door;
- operations history available;
- SMS failure visible per order;
- phone/tablet workflows pass.

## Gate E — Recovery

- deployment runbook rehearsed;
- rollback rehearsed;
- restore succeeds;
- manual outage procedure documented;
- monitoring/alerts verified.

Only after Gates A–E may the release be called public-launch ready.

---

# 15. Implementation Order and Pull-Request Discipline

Recommended PR sequence:

1. `v11-baseline-and-governance`
2. `v11-public-order-access`
3. `v11-audit-authenticity`
4. `v11-checkout-concurrency`
5. `v11-checklist-invariants`
6. `v11-stock-count-cas`
7. `v11-branch-isolation-and-service-role-containment`
8. `v11-operational-snapshot`
9. `v11-owner-os-consolidation`
10. `v11-observability-and-recovery`
11. `v11-pricing-provenance`
12. `v11-production-certification`

Each PR must contain:

- stated invariants;
- migration impact;
- failure cases;
- tests proving denial as well as success;
- observability impact;
- rollback/forward-fix notes;
- documentation update;
- no unrelated feature work.

Do not combine all V11 work into one giant patch. Security hotfixes must remain reviewable and deployable independently.

---

# 16. Alternative Considerations

## 16.1 Automatic stock depletion now

Rejected for V11 launch. It would create false precision unless product-to-batch allocation and variable-weight handling are solved. Periodic reconciliation is more honest for the current operational reality.

## 16.2 Keep all three owner summary surfaces

Rejected. More surfaces increase disagreement, maintenance and training burden. Today becomes canonical; Advanced Insights remains secondary.

## 16.3 Keep order reference as a secret

Rejected. The format is sequential and human-readable. It cannot be rehabilitated as an authorization credential.

## 16.4 Rely on UI validation for checklists

Rejected. Compliance evidence must survive a forged client or direct RPC call.

## 16.5 Keep demo fallback for “resilience”

Rejected in production. Plausible false data is corruption of operator understanding, not resilience.

## 16.6 Add a new dashboard to solve overload

Rejected. V11 must delete/consolidate before adding another presentation layer.

## 16.7 Replace Supabase/Postgres

Rejected. The current stack is capable of enforcing the required invariants. The problem is boundary design and incomplete enforcement, not the database technology.

---

# 17. Success Metrics

V11 is successful when:

- zero public order data is available by reference enumeration;
- zero unauthorised cancellations are possible;
- every material write has authentic audit evidence;
- concurrency tests never exceed configured capacity;
- a stale count can never overwrite newer inventory state;
- an incomplete checklist can never be completed;
- Today, Open, Counter, Close and Stock Count form one understandable daily loop;
- no production screen silently renders demo data;
- all intelligence on one page shares one `asOf` snapshot;
- owner decisions expose freshness and confidence;
- production deployment and restore are reproducible;
- Dad can operate the daily flow without choosing between competing summary pages;
- staff can see and recover from SMS/realtime failure;
- the system reports uncertainty rather than inventing certainty.

---

# 18. Required Documentation Updates

Update or create:

- `docs/v11-master-spec.md`
- ADR: public order access boundary
- ADR: audit authenticity boundary
- ADR: inventory periodic reconciliation mode
- ADR: operational snapshot architecture
- ADR: checklist definition and completion invariants
- deployment runbook
- rollback runbook
- restore drill runbook
- incident response checklist
- data retention/privacy map
- owner operating guide
- staff counter outage guide
- migration verification guide
- sanitised audit-bundle guide

The old full-audit pack must be corrected where it claims the public status flow uses a restricted RPC. Documentation must be generated or verified by executable assertions where practical.

---

# 19. Instructions to the Implementing AI

The implementing AI must operate as a principal engineer, not a feature generator.

Before modifying code:

1. inspect the current implementation and tests;
2. state the invariant being introduced;
3. identify all callers and data paths;
4. identify migration and rollback impact;
5. define adversarial tests first;
6. refuse to weaken an invariant merely to preserve a UI shortcut.

During implementation:

- use small, reviewable commits;
- avoid hidden fallback;
- avoid stringly typed error handling;
- keep retries bounded;
- preserve idempotency;
- make branch scope explicit;
- make time source explicit;
- make data freshness explicit;
- never log secrets or unnecessary PII;
- never add a second source of truth;
- do not declare a phase complete from typecheck/build alone.

Before declaring completion, provide:

- changed-file inventory;
- migration summary;
- invariants proved;
- tests run and exact results;
- adversarial cases exercised;
- performance/concurrency evidence where applicable;
- remaining limitations;
- clean `git status`;
- commit hash;
- production actions still required.

Any limitation that affects safety, privacy, stock truth, money, compliance or recovery must be stated explicitly.

---

# 20. Memory Integration / Canonical Future Direction

The canonical product direction after V11 is:

```text
Today
  → Open safely
  → Serve through Counter
  → Capture exceptions during the day
  → Close honestly
  → Reconcile stock and waste
  → Learn from one trusted operational snapshot
```

PlaiceToMeat’s defensible advantage should not be “more dashboard panels”. It should be that a first-time independent butcher can run the shop with disciplined evidence, truthful numbers, clear next actions and recoverable systems.

Future phases may add repeat-customer intelligence, supplier intelligence, seasonal packs, WhatsApp, Qurbani and multi-branch support only after the V11 security, invariant and recovery gates remain green in real operation.

---

# Appendix A — Source Findings That Override the Audit Pack

These findings were confirmed in the supplied source baseline and must be treated as authoritative until fixed.

1. **Sequential references:** `supabase/migrations/202605300001_v2_phase_a_backbone.sql`, `next_order_ref`, returns `PTM-YYYY-NNNNN`.
2. **Public full-order read:** `src/lib/server/orders.ts`, `getOrderByRef`, uses the service-role client and internal `ORDER_SELECT`.
3. **Public page:** `src/app/order/[orderRef]/page.tsx` reads by reference and renders customer name, items and subtotal.
4. **Reference-only cancellation:** `src/app/actions/cancel-order.ts` calls `cancel_order_by_ref` with order reference and reason only.
5. **Anon cancellation RPC:** `supabase/migrations/202605310002_v2_phase_e_customer_cancel.sql` grants execution to anon/authenticated and does not lock the row before checking/updating.
6. **Forgeable audit writes:** init/V3 migrations allow authenticated insertion into `audit_logs`/`audit_events`.
7. **Capacity race:** `create_checkout_order` performs count-then-insert without an atomic reservation/lock.
8. **Duplicate SKU semantics:** checkout schema and SQL validate each submitted row but do not reject/aggregate repeated product IDs.
9. **Checklist completion gap:** `ops_complete_session` marks a session complete without proving required step evidence.
10. **Arbitrary checklist steps:** `ops_record_step` validates non-empty key/state but not membership in a versioned definition.
11. **Stale stock apply:** `ops_apply_stock_count_line` applies the previously counted value without comparing the batch’s current version/state to the count snapshot.
12. **Cross-branch dashboard metric:** `src/lib/server/dashboard.ts` weekly waste count omits a branch predicate while using service-role access.
13. **Broad demo fallback:** catalog, settings, orders and other server reads may substitute demo data after missing configuration/query failure.
14. **No security-header configuration:** `next.config.ts` contains no security header policy.
15. **Repeated intelligence reads:** current Owner Brain/Shop Intelligence/Operations Intelligence/Purchasing composition performs overlapping loads.

---

# Appendix B — Immediate “Do Not Launch” Checklist

Until all are checked, public launch is blocked:

- [ ] Reference-only public status removed
- [ ] Reference-only cancellation removed
- [ ] Cancellation race fixed
- [ ] Public endpoint rate limiting active
- [ ] Direct audit insert policies revoked
- [ ] Pickup capacity atomic
- [ ] Duplicate SKU bypass closed
- [ ] Daily order cap enforced or removed
- [ ] Checklist completion enforced by DB
- [ ] Stock-count stale apply blocked
- [ ] Cross-branch waste metric fixed
- [ ] Production demo fallback disabled
- [ ] Test/bootstrap accounts removed from production
- [ ] Production migrations match repository
- [ ] Security headers verified
- [ ] Mobile/tablet workflows pass
- [ ] Butcher yield/pricing review complete or all values visibly provisional
- [ ] Monitoring alerts verified
- [ ] Rollback rehearsed
- [ ] Restore drill passed
- [ ] Controlled production smoke passed

