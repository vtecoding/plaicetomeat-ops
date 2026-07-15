# oPTM Operational Audit Input

## 1. Document Control

| Field | Value | Evidence state and source |
| --- | --- | --- |
| Generated | 2026-07-13T14:18:59+01:00 (Eurpe/London) | `VERIFIED_IMPLEMENTATION` — local `Get-Date` during generation |
| Audited branch | `main`, tracking `origin/main` | `VERIFIED_IMPLEMENTATION` — `git status --short --branch` |
| Audited commit | `f7d4380f12648cf6495675fd0941f519a38d5093` | `VERIFIED_IMPLEMENTATION` — `git rev-parse HEAD` |
| Working-tree state before this dossier | Dirty: pre-existing modification to `docs/reports/disaster-recovery-certification.md`; no other change | `VERIFIED_IMPLEMENTATION` — `git status --porcelain=v1`; the modified file is local test output and is not part of this dossier's commit |
| Repository | `plaicetomeat-ops`; origin `vtecoding/plaicetomeat-ops` | `VERIFIED_IMPLEMENTATION` — `package.json`; `git remote get-url origin` |
| Repository migration head | `202607111100_shortfall_owner_alert.sql`; 41 migrations | `VERIFIED_IMPLEMENTATION`; `VERIFIED_TEST` — `supabase/migrations/`; `pnpm verify:migration-manifest` passed and `migration-manifest.generated.ts` declares head `202607111100`, count 41 |
| Production migration head | Latest repository evidence says 41/41 at `202607111100`; not probed during this consolidation | `DOCUMENTED_ONLY` for the 2026-07-11 production observation, not current live proof — closeout addendum in `PTM_POST_REMEDIATION_VERIFICATION_REPORT.md`; `UNKNOWN` after that observation |
| Deployed build identity | Last evidenced production build was canonical-main commit `900db21`; current deployed identity is not verifiable from repository-only inspection and later commits exist through `f7d4380` | `CONFLICTED` — closeout addendum in `PTM_POST_REMEDIATION_VERIFICATION_REPORT.md` versus later `git log`; `/api/health` can expose a live SHA but was not queried in this repository-only pass |
| Local validation | 82 test files, 634 tests passed; typecheck passed; migration manifest passed | `VERIFIED_TEST` — `pnpm test`, `pnpm typecheck`, `pnpm verify:migration-manifest`, run 2026-07-13 |
| Generation method | Read-only inventory of current App Router pages/API routes, middleware, server actions/services, migrations/RPCs, tests, validation scripts, workflows, runbooks, reports, architecture and historical audits; this Markdown file is the only intended repository change | `VERIFIED_IMPLEMENTATION` — command log in this generation session |

**Truth boundaries.** “Repository truth” means code/migrations at the audited commit. “Local runtime truth” is limited to the three non-destructive validations above; no browser, local database, or production mutation was used. “Production truth” is stated only when a dated production evidence record exists. A historical production observation is not treated as proof of current deployment state.

**Evidence limitations.** No real owner/operator interview, physical shop-day observation, task timing, payment-terminal inspection, production API probe, current GitHub Actions query, current production schema dump, or current backup-artifact download was performed. The dirty recovery certificate is explicitly labelled `LOCAL TEST DATA ONLY / NOT VALID FOR LAUNCH CERTIFICATION`; its changed row counts are local runtime evidence only. Generated screenshots and older reports support historical UI state but do not override current routes/components.

Evidence labels used for claims below are exactly: `VERIFIED_IMPLEMENTATION`, `VERIFIED_TEST`, `VERIFIED_DRILL`, `DOCUMENTED_ONLY`, `INFERRED`, `CONFLICTED`, `UNKNOWN`. `NOT_MODELLED` is used only as the inventory-model marker permitted by this dossier's specification.

## 2. Executive System Snapshot

PTM is a single-shop butcher operations and click-and-collect system built with Next.js App Router and Supabase/Postgres. Its public surfaces let customers browse products, manage a browser basket, place a pay-on-collection order, prove access with order reference plus phone, view status, and cancel while an incoming-order time window remains open. Staff use three distinct surfaces: `/operator` is a large-control guided mode for the recorded low-computer-literacy co-owner “Uncle Gul”; `/counter` is an active order board and daily compliance surface for staff; `/admin` is the owner/manager operating, analysis and configuration console. `[VERIFIED_IMPLEMENTATION: src/app/**; src/middleware.ts; docs/architecture/ptm-production-architecture.md]`

Core capabilities include catalogue/pricing, pickup capacity and closures, order creation and status transitions, cash/card method recording for walk-in sales, collection-triggered inventory depletion, batches and expiry, waste, stock counts and corrections, opening/closing checklists, temperature/compliance records, supplier certificates, carcass pricing/intake, operator photo evidence, owner decision compression, purchasing/business intelligence, owner-away summaries, audit logs, releases, health/migration/backup freshness and encrypted logical backup/restore tooling. `[VERIFIED_IMPLEMENTATION: src/app; src/lib/server; src/app/actions; supabase/migrations]`

Operational maturity is mixed. Current repository checks pass, production parity was last recorded at 41/41, and previously open migration, health masking and oversell-alert findings are documented as closed. A later recovery drill records an empty-database restore of 49 tables, row-hash equality across seven critical tables, deliberate orders corruption and recovery, and about four seconds at current data size. `[VERIFIED_TEST: 634 tests; migration manifest] [VERIFIED_DRILL: docs/runbooks/ptm-phase1-recovery.md]` Exact current deployment SHA and live backup freshness remain `UNKNOWN`. The most defensible status is a repository with controlled-pilot evidence and strong recovery drill evidence, not a current production-readiness declaration. `[CONFLICTED: PTM_MASTER_AUDIT_REPORT.md; PTM_REMEDIATION_PHASE_1_REPORT.md; PTM_POST_REMEDIATION_VERIFICATION_REPORT.md; later commits]`

## 3. Stakeholders and Real-World Users

### Owner

- Responsibilities: shop supervision; owner-only audit, release and Owner Away surfaces; manager work including prices, products, stock, supplier paperwork, schedules, settings, Today decisions and reconciliation. `[VERIFIED_IMPLEMENTATION: src/lib/domain/route-access.ts; src/app/admin/**]`
- Likely frequency: Today/morning briefing is designed for daily use; Owner Away can cover an absence window. This frequency is `INFERRED` from `src/app/admin/today/page.tsx`, `src/lib/server/owner-away.ts` and `docs/v15/owner-brain-doctrine.md`, not observed behaviour.
- Decisions expected: up to three “Do now” actions, later items, purchasing/stock/certificate/pricing decisions, delivery costs, waste reviews and open alerts. `[VERIFIED_IMPLEMENTATION: src/lib/owner-brain/action-compression.ts; src/app/admin/today/page.tsx; src/components/reconcile-client.tsx]`
- Information: morning sentences, orders/revenue/waste/stock risk/certificates, profit estimates, customer and basket patterns, owner-away summary, evidence, audit and recovery health via technical surfaces. `[VERIFIED_IMPLEMENTATION: src/app/admin/page.tsx; src/app/admin/today/page.tsx; src/components/admin-owner-away-client.tsx; src/app/api/health/route.ts]`
- Owner-only actions: `/admin/audit`, `/admin/releases`, `/admin/away`, and toggling Owner Away. `[VERIFIED_IMPLEMENTATION: OWNER_ONLY_ROUTES in src/lib/domain/route-access.ts; setOwnerAwayMode]`
- Simplicity: maximum system capability with minimum operator skill, one compressed Today view, plain actions, no score/confidence leakage. `[DOCUMENTED_ONLY as owner/product requirement: docs/architecture/ptm-production-architecture.md §§1–3; docs/v15/owner-brain-doctrine.md]`; implemented shape is separately verified by owner-brain modules and tests.
- Constraints/frustrations: documentation names “Dad” as a non-technical owner and records hesitation around dense screens, navigation and deciding what matters. `[DOCUMENTED_ONLY: docs/full-audit-pack-v11/10-user-workflow-map.md; docs/v15/*]` No current owner interview exists.
- Absence: Owner Away changes the summary window to `away_since` and shows open/close, sales, deliveries, waste, sale kg, evidence, certificates and unresolved alerts. It does not schedule or send the documented daily narrative itself. `[VERIFIED_IMPLEMENTATION: src/lib/server/owner-away.ts; src/components/admin-owner-away-client.tsx] [CONFLICTED: docs/v17/00-Operator-Mode-Spec.md §16 promises daily dispatch]`

### Low-Computer-Literacy Operator

- Intended user: “Uncle Gul”, a manager-rank account with `operator_mode=true`, locked to `/operator`. `[DOCUMENTED_ONLY requirement: docs/v17/00-Operator-Mode-Spec.md §§1,4] [VERIFIED_IMPLEMENTATION: profiles.operator_mode migration; middleware; route-access.ts]`
- Assumptions: large touch targets, one question at a time, plain language, little typing and no admin concepts/analytics. `[VERIFIED_IMPLEMENTATION: src/app/operator/**; verify:operator-language; verify:operator-firewall]`
- Permitted: open, close, weight-based walk-in sale, kg delivery, ran-out report, waste, paper/photo capture, help/escalation. `[VERIFIED_IMPLEMENTATION: src/app/operator; src/app/actions/operator]`
- Prohibited: `/admin` and `/counter`; each/box serve/delivery paths are escalated rather than recorded as weighted stock. `[VERIFIED_IMPLEMENTATION: canAccessStaffPath; resolveServeLines; confirmSimpleDelivery]`
- Assistance: prefilled opening float and delivery defaults from history; product tiles; “tell owner” escape; calm generic failures. `[VERIFIED_IMPLEMENTATION: getOpeningFloatDefault; resolveDeliveryDefaults; operator flows/error.tsx]`
- Mistake recovery: before confirmation, Back/Change controls exist; checklist steps can be re-entered locally. After persistence, there is no operator undo; owner uses stock count/correction or investigates alerts/audit. `[VERIFIED_IMPLEMENTATION: operator components; admin_adjust_inventory_remaining; ops_apply_stock_count_line]`
- Escalation: durable `owner_alerts` row and audit event. This is an in-app inbox signal; `createOwnerAlert` does not call the webhook dispatcher. `[VERIFIED_IMPLEMENTATION: src/app/actions/operator/escalation.ts]`
- Owner dependency: unknown products/suppliers, each/box stock, missing invoice cost, uncertain waste and shortfalls all create owner work. `[VERIFIED_IMPLEMENTATION: operator delivery/waste/serve actions; reconcile tray]`

### Counter Staff

`/counter` remains active. It is not retired: it has an order board with incoming/prepping/ready/collected columns, status actions, cancellation, notes, SMS state, realtime/polling status, order detail, and `/counter/compliance`. It duplicates part of `/operator/serve` (sales) and `/admin/orders` (order visibility) but uniquely manages online-order preparation/ready/collection. `[VERIFIED_IMPLEMENTATION: src/app/counter; src/components/counter-dashboard.tsx]` Claims that “counter mode” was removed refer only to the former `/admin?mode=counter`; the dedicated `/counter` surface still ships. `[CONFLICTED: docs/v16/00-Reality-Map.md §1; tests/e2e/admin-mobile-dashboard.spec.ts; current route]`

### Customer

- Browsing/basket: active products/categories from Supabase; basket is browser state. `[VERIFIED_IMPLEMENTATION: /shop, /product/[slug], BasketClient]`
- Checkout: name, UK phone, optional email/notes, date/window, pay-on-collection order; server recomputes prices and controls idempotency/capacity. `[VERIFIED_IMPLEMENTATION: CheckoutClient; submitCheckout; create_checkout_order]`
- Collection/status: reference+phone establishes signed access, then status URL shows customer-safe order details; ready tells customer to pay at counter. `[VERIFIED_IMPLEMENTATION: establishPublicOrderAccess; /order/status/[publicAccessId]]`
- Payments: no online payment is taken; staff records cash/card on operator walk-in sale, but online orders have no implemented tender-capture step. External till/card reader is assumed. `[VERIFIED_IMPLEMENTATION: PayOnCollectionNote; payment_method column; saveSimpleSale]`
- Exceptions: incoming orders can be cancelled within the configured window after identity confirmation; later cancellation says call shop. No implemented self-service amendment, substitution, refund or receipt. `[VERIFIED_IMPLEMENTATION: cancellation.ts; cancel-order.ts]`

### Manager or Additional Staff

- `manager`: all ordinary `/admin` work and `/counter`, but not owner-only audit/releases/away. `[VERIFIED_IMPLEMENTATION: route-access.ts]`
- `staff`: `/counter` only, plus compliance capture; cannot enter `/admin` or `/operator`. `[VERIFIED_IMPLEMENTATION: route-access.ts; route-protection.spec.ts]`
- An owner has global rank but branch-scoped pages still require a concrete branch context in current server guards. `[VERIFIED_TEST: staff-context.test.ts]`
- A manager can see Owner Away cards/links on Today but is denied `/admin/away`; the UI filters owner-only tool links using the current profile role, while the top summary component is still computed for managers. `[VERIFIED_IMPLEMENTATION: today/page.tsx; route-access.ts]`

## 4. Owner Requirements Register

| Requirement ID | Requirement | Source | Current interpretation | Evidence state | Implemented by | Validation | Open ambiguity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OR-01 | Maximum technical capability with minimum operator skill | `docs/architecture/ptm-production-architecture.md` §1 | Complex writes remain behind guided adapters | DOCUMENTED_ONLY; VERIFIED_IMPLEMENTATION | `/operator`, server actions/RPCs | operator firewall/language scripts | Owner acceptance not observed |
| OR-02 | Uncle Gul gets one guided front door | `docs/v17/00-Operator-Mode-Spec.md` §§1,5 | `/operator` only for flagged account | VERIFIED_IMPLEMENTATION | middleware, `canAccessStaffPath` | `verify:operator-route-lock`; route-access tests | Account provisioning in production unknown |
| OR-03 | Operator must not enter admin/counter | V17 §§4,18 | absolute route lock | VERIFIED_IMPLEMENTATION | middleware + signed session + role/flag | route protection tests/guard | Real device session test not current |
| OR-04 | Very few, big choices | V17 §§6,19 | five work tiles plus Help; one question at a time | VERIFIED_IMPLEMENTATION | operator home/flows | Dad usability screenshots; static guards | Spec says “4-button”; actual has five tiles plus Help |
| OR-05 | Little text and plain butcher language | V17 §19; owner-brain doctrine | jargon blocked on strict surfaces | VERIFIED_IMPLEMENTATION | operator copy; `deJargon` | `verify:operator-language`, intelligence firewall | Client admin components are outside surface-convergence sweep |
| OR-06 | No analytics/scores/percentages on operator surface | V17 Goal 5 | intelligence firewall | VERIFIED_IMPLEMENTATION | `toOperatorAction`; operator routes | owner-brain/firewall tests | `/admin` remains metric-rich for managers |
| OR-07 | Common action should be one clear next step | owner-brain doctrine; V15.1 | Today `Do now` capped at 3; operator home highlights one door | VERIFIED_IMPLEMENTATION | action compression; operator home | action-compression/today tests | Actual completion time unknown |
| OR-08 | One tap should reach the work, not execute an irreversible change | V15.2 certificate | action target links to work screen | VERIFIED_TEST | `resolveActionTarget` | action-target tests | No real-owner confirmation |
| OR-09 | Owner receives only actionable priority information | owner-brain doctrine | Today briefing + Do now/Later | VERIFIED_IMPLEMENTATION | owner brain/Today | owner-brain E2E and unit tests | Admin hub still exposes many metric panels |
| OR-10 | Owner understands the day quickly | V15.3 certificate | three briefing sentences above actions | VERIFIED_IMPLEMENTATION | `buildMorningBriefing` | morning-briefing tests/script | “under 30 seconds” not human-timed |
| OR-11 | Owner can be away for a week and shop continues | V17 Goal 4/A0.4 | operator mode plus owner-away summary | CONFLICTED | owner-away toggle/summary | owner-away unit tests | No week-long field test; no scheduled summary sender |
| OR-12 | Anything uncertain must have a “tell owner” route | V17 §§17,19 | help, critical skips, stock/waste uncertainty | VERIFIED_IMPLEMENTATION | owner alert adapter | help tests; operator flows | Alerts are in-app; external delivery not guaranteed |
| OR-13 | Failures explained plainly and never appear successful | architecture §§2,17 | typed action results, error surfaces, partial checkout result | VERIFIED_IMPLEMENTATION | server actions/error.tsx | failure-surfaces and checkout action tests | Many DB failures reduce to “Try again” |
| OR-14 | Operator can recover after interruption | V17 §7 | checklist state persisted; completed operator runs idempotent | CONFLICTED | checklist sessions/events; workflow runs | ops-capture E2E; action tests | Non-checklist flows do not persist every intermediate screen |
| OR-15 | Operator action must create normal backend truth, not a shadow log | V17 Goals 2–3 | adapters invoke orders, batches, movements, checklists and audit | VERIFIED_IMPLEMENTATION | actions/operator; RPCs | command-path evidence in post-remediation report | Full browser proof missing for all flows |
| OR-16 | Stock reflects physical reality | architecture §4; V14 truth pack | collection depletes; counts reconcile; ledger/cache | VERIFIED_IMPLEMENTATION | inventory RPCs/views | inventory integrity guards/tests | Physical count accuracy unobserved; each/box gap |
| OR-17 | Stock never silently goes negative | V14 invariant 1 | floor at zero plus explicit shortfall | VERIFIED_IMPLEMENTATION | `deplete_order_inventory`; checks | inventory integrity DB guard | Production current parity not freshly probed |
| OR-18 | Oversell remains visible to owner | V14 failure F11; master audit | shortfall row, audit and owner alert | VERIFIED_IMPLEMENTATION | migration `202607111100` trigger | `verify:shortfall-owner-alert` | Alert resolution path absent |
| OR-19 | Collection consumes stock once | V14 invariants | unique depletion and movement keys | VERIFIED_IMPLEMENTATION | `order_inventory_depletions`; RPC locks | collection-stock/unit and DB validation | Live race harness not current |
| OR-20 | Consume batches FEFO | V14 batch model | expiry, received date, id ordering | VERIFIED_IMPLEMENTATION | `deplete_order_inventory` | inventory validation | Physical staff batch choice not captured |
| OR-21 | Every correction stays traceable | V14 invariants | compensating movement/audit; no ledger edit | VERIFIED_IMPLEMENTATION | stock-count/adjust/reversal RPCs | truth-hardening tests | Reversal RPC has no UI |
| OR-22 | Delivery and waste are easy to record | V17 §§11,14 | guided kg flows; optional photo; defaults | VERIFIED_IMPLEMENTATION | operator stock/waste | workflow helper tests | Each/box/carcass operator flows escalate or are absent |
| OR-23 | Operator is not responsible for certificate state | owner amendment A0.2 | operator only captures paper/photo; owner manages supplier status | VERIFIED_IMPLEMENTATION | certificate flow; admin compliance | static/source evidence | Automatic expiry-to-owner-alert is not implemented as specified |
| OR-24 | Opening and closing are simple and resumable | V17 §15 | fixed one-step-at-a-time ritual; completion receipt | VERIFIED_IMPLEMENTATION | checklist definitions/actions | ops-capture E2E | Checklist copy still tells operator to verify certificates |
| OR-25 | Required temperature/till readings cannot be skipped to completion | later required-evidence requirement | numeric skip blocks finish | VERIFIED_IMPLEMENTATION | operator checklist; migration `202606291000` | `verify:required-compliance` | Till amount is captured but not reconciled to tender totals |
| OR-26 | Counter service must be fast and physically rehearsed | owner amendment A0.3 | weight-only guided sale exists | CONFLICTED | operator serve flow | unit/command-path tests | No recorded physical rehearsal or timing |
| OR-27 | Walk-in cash/card method must be recorded | operator serve flow/spec | `payment_method` on collected order | VERIFIED_IMPLEMENTATION | `saveSimpleSale` | post-remediation command-path evidence | No payment success/terminal reference |
| OR-28 | Customer sees clear pay-on-collection status | public product requirement | status and ready messaging | VERIFIED_IMPLEMENTATION | public order routes | safe-test-order E2E | Receipt/support handling absent |
| OR-29 | Owner can explain why a number changed | architecture/audit model | movements, status events and audit logs retain actor/reason | VERIFIED_IMPLEMENTATION | audit/movement model | audit/inventory guards | UI does not join every metric to its underlying event |
| OR-30 | Recovery restores current schema and critical records | recovery runbook | full encrypted logical restore + parity/hash/drill | VERIFIED_DRILL | backup/restore scripts and runbook | 2026-07-13 documented drill | Current scheduled freshness and storage object bytes unknown |

## 5. Goals and Non-Goals

**Current explicit goals.** Run a click-and-collect butcher shop; preserve money/order/inventory truth; give a low-tech operator guided actions; give the owner a compressed daily operating view; keep failures and uncertainty visible; retain attributable evidence; support recovery. `[VERIFIED_IMPLEMENTATION: current routes, migrations and actions] [DOCUMENTED_ONLY: architecture §§2,4; V17 §2]`

**Inferred goals.** Single-branch/pilot-scale operation, pay-on-collection, mobile/tablet counter use, and supporting both owner-led and delegated operation. `[INFERRED: branch-scoped queries; PayOnCollectionNote; CSS/tests; Owner Away]`

**Deprecated goals.** `/admin/briefing` as a separate destination and `/admin?mode=counter` are deprecated; they redirect or render the analysis hub rather than old modes. Legacy `/order/[orderRef]` authorization is removed and redirects to lookup. `[VERIFIED_IMPLEMENTATION: briefing page; legacy order pages; admin-mobile-dashboard.spec.ts]`

**Future/documented-only goals.** Scheduled owner-away daily delivery, automatic certificate-expiry owner alerts, product photo classification, full each/box conversion, optional reservations, telemetry sink, partial-refund modelling and longer-horizon retention are not current behaviour. `[DOCUMENTED_ONLY: V17 §§10.1,16; docs/v14/11-each-box-conversion-design.md; architecture §§16,20–21]`

**Non-goals.** Operator Mode is not a second admin, not an analytics surface, not autonomous AI, and not a replacement for Today. The system does not implement online payment processing. `[DOCUMENTED_ONLY: V17 §3; architecture §3] [VERIFIED_IMPLEMENTATION for payment: PayOnCollectionNote]`

Contradiction: V16 says screen consolidation left few destinations and “counter-mode removed,” while 55 current route handlers include three staff families and 27 admin pages; only the admin query mode was removed. `[CONFLICTED: docs/v16/00-Reality-Map.md; src/app]`

## 6. Current Surface and Route Inventory

There are **55 active route handlers present**: 53 pages and 2 API routes. Three pages are redirect-only (`/admin/briefing`, `/order/[orderRef]`, `/order/[orderRef]/cancel`); the other 52 render or process a request. `[VERIFIED_IMPLEMENTATION: Get-ChildItem src/app; files below]`

| Surface | Route | Intended user | Primary purpose | Main actions | Data read | Data written | Current status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public | `/` | Customer | Home/trust/featured products | Browse | branches, products | none | active | `src/app/page.tsx` |
| Public | `/shop` | Customer | Catalogue | Filter/browse/add | categories, products | browser basket | active | `shop/page.tsx`, ProductCard |
| Public | `/product/[slug]` | Customer | Product detail | Add to basket | product/category | browser basket | active dynamic | route file |
| Public | `/basket` | Customer | Basket | change/remove/proceed | browser storage | browser storage | active | BasketClient |
| Public | `/checkout` | Customer | Order form | place order | branch/settings/windows/basket | order via action | active | CheckoutClient |
| Public API | `/api/checkout` | API customer | Programmatic checkout | POST | catalogue/window via service | order/items/status/audit | active | `api/checkout/route.ts` |
| Public | `/order/lookup` | Customer | Prove order access | ref+phone | privileged lookup RPC | signed access cookie | active | OrderLookupForm |
| Public | `/order/status/[publicAccessId]` | Customer | Live status | view/cancel door | safe status RPC | rate-limit state only | active | route file |
| Public | `/order/status/[publicAccessId]/cancel` | Customer | Cancel eligible order | confirm cancellation | status/access cookie | cancelled status/event/audit | active | route + cancel action |
| Legacy | `/order/[orderRef]` | Old links | Redirect to lookup | none | validates ref shape | none | redirect-only | route file |
| Legacy | `/order/[orderRef]/cancel` | Old links | Redirect to lookup | none | validates ref shape | none | redirect-only | route file |
| Public | `/our-halal-promise` | Customer | Trust statement | view | safe supplier status | none | active | route file |
| Public | `/privacy` | Customer | Privacy notice | view | static | none | active | route file |
| Auth | `/login` | Staff | Sign in | login/reset door | auth/profile | auth session/envelope | active | login/action auth |
| Auth | `/auth/update-password` | Staff | Password reset | update password | auth token | auth password | active | route/component |
| Exception | `/unauthorised` | Staff | Access recovery | go appropriate home | none | none | active | route file |
| Operator | `/operator` | Flagged manager/owner preview | Guided home | open/serve/stock/paper/close/help | today's checklists | none | active; overlaps counter/admin | operator page |
| Operator | `/operator/open` | Operator | Opening ritual | record/skip/finish | checklist/default float | sessions/events/audit/alerts | active | operator open/checklist |
| Operator | `/operator/serve` | Operator | Walk-in kg sale | lines, cash/card, confirm | products | order/items/events/movements/alerts | active | serve flow/action |
| Operator | `/operator/stock` | Operator | Delivery/ran-out | record kg delivery/report | products/suppliers/history | batch/movement/evidence/alerts | active | stock flow/action |
| Operator | `/operator/waste` | Operator | Waste | record/no waste/photo | products/batches | waste/movement/evidence/alerts | active; linked from stock | waste flow/action |
| Operator | `/operator/certificate` | Operator | Paper photo | classify broadly/upload | none | evidence/compliance document/alert | active | certificate flow/action |
| Operator | `/operator/close` | Operator | Closing ritual | record/skip/finish | checklist | sessions/events/audit/alerts | active | close/checklist |
| Operator | `/operator/help` | Operator | Escalate inability | choose/note/tell owner | none | owner alert/audit | active | help flow/action |
| Counter | `/counter` | staff/manager/owner | Online-order board | prep/ready/collect/cancel/note/refetch | orders/items/notes/windows | status/events/depletion/notes/SMS log | active, not retired | CounterDashboard |
| Counter | `/counter/orders/[id]` | staff | Order detail | view/back | order/items | none | active but board is main work surface | route file |
| Counter | `/counter/compliance` | staff | Daily temperatures/checks | add readings/complete | compliance day | logs/readings | active; duplicates checklist evidence partly | ComplianceClient |
| Admin | `/admin/today` | manager/owner | Primary daily OS | briefing, Do now, Later, links | operational snapshot, owner-away, reconcile | none directly | active primary | today page |
| Admin | `/admin/today/[id]` | manager/owner | Decision detail | follow action target | owner brain | none | active dynamic | route/DecisionDetail |
| Admin | `/admin/today/walk` | manager/owner | Guided decision walk | next/back | owner brain | none | active; does not mark tasks done | GuidedDay |
| Admin | `/admin/briefing` | manager/owner | Old briefing URL | redirect | none | none | redirect-only to Today | page |
| Admin | `/admin` | manager/owner | Analysis/shop detail | inspect metrics/tools | dashboard + intelligence | none | active secondary analysis hub | admin page |
| Admin | `/admin/open` | manager/owner | Opening checklist | record/finish | checklist state | checklist events | active; duplicates operator skin | ChecklistPage |
| Admin | `/admin/close` | manager/owner | Closing checklist | record/finish | checklist state | checklist events | active; duplicates operator skin | ChecklistPage |
| Admin | `/admin/stock-count` | manager/owner | Physical count/reconcile | record/apply/finish | active batches | count lines/movements/audit | active | StockCount |
| Admin | `/admin/reconcile` | manager/owner | Cost/waste review tray | add cost/review | owner alerts/batches/runs | batch cost, resolved_at, audit | active; only two actionable alert kinds | ReconcileClient |
| Admin | `/admin/inventory` | manager/owner | Batches/expiry/waste | receive/waste/count door | batches/products/suppliers | batches/movements/waste | active | AdminInventoryClient |
| Admin | `/admin/purchasing` | manager/owner | Buying guidance | review/follow links | intelligence/inventory | none | active | purchasing page/service |
| Admin | `/admin/products` | manager/owner | Catalogue/prices | add/edit/availability | products/categories | product/config/audit via RPC | active | AdminProductsClient |
| Admin | `/admin/orders` | manager/owner | Order history | view/link counter | orders | none | active; overlaps counter | route file |
| Admin | `/admin/compliance` | manager/owner | Supplier certificates | add/edit/verify | suppliers/docs | supplier records | active | AdminComplianceClient |
| Admin | `/admin/evidence` | manager/owner | Operator photos | view/delete | operator evidence/storage URL | soft-delete evidence/object | active | AdminEvidenceClient |
| Admin owner | `/admin/away` | owner | Absence overview | toggle/view | summary tables/alerts | away settings/audit | active owner-only | page/client/action |
| Admin | `/admin/cutting-guide` | manager/owner | Carcass value/pricing/intake | calculate/confirm/map | products/costs/suppliers | carcass intake/cuts/batches/product cost-price | active complex | CarcassCalculator |
| Admin | `/admin/validation/pricing` | manager/owner | Butcher sign-off | approve/changes | pricing validations | decision/reviewer | active | PricingValidationClient |
| Admin | `/admin/pickup-windows` | manager/owner | Collection capacity | create/edit/toggle | windows | windows/audit | active | client/actions |
| Admin | `/admin/shop-closures` | manager/owner | Closed dates | add/remove | closures | closures/audit | active | client/actions |
| Admin | `/admin/settings` | manager/owner | Branch/customer text | edit | branch/settings | settings/audit | active | client/action |
| Admin | `/admin/setup` | manager/owner | Launch checklist | follow items | products/staff/orders/certs | none | active | setup service/page |
| Admin | `/admin/guide` | manager/owner | Everyday guides/dry run | read | static content | none | active | route file |
| Admin | `/admin/playbooks` | manager/owner | Playbook index | open | static content | none | active | route file |
| Admin | `/admin/playbooks/[slug]` | manager/owner | Playbook detail | read | static content | none | active dynamic | route file |
| Admin owner | `/admin/audit` | owner | Activity evidence | filter | audit events | none | active owner-only | route/service |
| Admin owner | `/admin/releases` | owner | Release ledger | verify/certify | release/migration rows | verification/certification | active owner-only | page/client/actions |
| Health API | `/api/health` | support/owner tooling | Runtime/build/schema/backup truth | GET | migration/backup RPCs, memory metrics | none | active; live state not probed | route file |

No current route is proven dead. The three redirect routes are deliberately retained compatibility routes. Partially implemented surface-level promises: Owner Away has no scheduler/outbound summary; owner alerts have no general inbox/action route; refund/reversal has a database RPC but no route; setup is observational rather than a stateful checklist. `[VERIFIED_IMPLEMENTATION]`

## 7. End-to-End Workflow Catalogue

Each row compresses actor/trigger/entry/steps/decisions/data/success/recovery/escalation/evidence. “No UI” means repository capability exists below the surface but is not an operator workflow.

| # | Workflow as implemented today | Evidence and coverage | Gaps/irreversibility |
| --- | --- | --- | --- |
| WF-01 | **Open shop** — operator/admin enters open page; start/resume; record 5 fixed steps; numeric fridge and float required if handled; skip critical creates alert; finish writes completed session and receipt; visible “shop is open.” | `VERIFIED_IMPLEMENTATION`: checklist definitions, OperatorChecklist, ops RPCs. `VERIFIED_TEST`: ops-capture E2E; required-compliance guard. | Completion is durable; no “reopen.” Physical opening not observed. |
| WF-02 | **Close shop** — same pattern with waste check, stock glance, cash total, fridge, cleaning, lock; finish receipt. | same evidence | Cash is not reconciled to recorded cash sales; “waste logged/stock glance” are confirmations, not proof of underlying work. |
| WF-03 | **Record temperature/compliance** — counter staff chooses reading type and enters chiller/freezer, optional display; RPC creates/uses daily log; completion requires opening+closing readings and three boolean checks. | compliance page/actions/RPC; validation and compliance tests | Operator checklist records a generic coldest reading in checklist evidence, not the three-field compliance RPC path. |
| WF-04 | **Serve walk-in customer** — operator selects kg products/custom item, enters weights/custom price, repeats lines, chooses cash/card, reviews and confirms; order is created and advanced to collected; stock depletion and alerts follow. | serve flow/action; serve-lines tests; post-remediation command-path evidence | No each/box sale; no customer identity; no tender confirmation/receipt; terminal collection is irreversible in UI. |
| WF-05 | **Create online order** — customer basket → checkout details/window → action/API → validation, merged SKUs, rate limit, server price calculation, window lock, idempotent order/items/event/audit; UI gets access cookie or partial-success recovery. | checkout/service/RPC; checkout unit/E2E/integrity script | No payment; no reservation; full current browser success not rerun here. |
| WF-06 | **Accept cash** — operator selects Cash before saving walk-in sale; order stores `payment_method='cash'`. | serve action; command-path evidence | No cash received/change/till transaction; online order collection does not record cash tender. |
| WF-07 | **Accept card** — same with `card`. | serve action; command-path evidence | No terminal integration, authorization result or failure recovery. |
| WF-08 | **Prepare order** — counter clicks Start Prep; `transition_order_status(incoming→prepping)`; card moves column, audit/status event persists. | CounterDashboard; counter persistence/realtime E2E | No undo to incoming. |
| WF-09 | **Mark ready** — counter clicks Mark Ready; status updates; SMS attempt is recorded honestly as disabled/failure/sent state. | counter action; sms-status E2E | Actual SMS provider may be absent; customer must refresh unless contacted. |
| WF-10 | **Collect order** — ready card → Collected; same DB transaction depletes kg batches FEFO and writes summary/shortfall. | transition/deplete RPC; inventory tests/guards | Each/box not depleted; collected terminal; no UI reversal. |
| WF-11 | **Cancel order** — staff can cancel pre-collection from board with browser confirm; customer can cancel only incoming within time window after ref+phone access. | counter and public cancel paths; safe-test-order E2E | No cancellation after collected; no refund because no online charge. |
| WF-12 | **Refund/reverse order** — manager-only `admin_reverse_order_inventory(order, reason)` appends compensating movements once per reason. | migration `202606090900`; truth-hardening unit tests | `DOCUMENTED_ONLY`: no route/action invokes it; no money refund, partial refund or user confirmation workflow. |
| WF-13 | **Receive delivery** — operator chooses Arrived, product, amount, defaults/changes supplier/storage/expiry, optional photo, review; kg batch with cost 0 and cost-pending alert. Admin can enter full dates, weight, cost, trace fields. | operator delivery action; admin inventory action/RPC | Operator each/box/unknown escalates; photo optional; no supplier order matching. |
| WF-14 | **Create inventory batch** — `admin_create_inventory_batch` validates branch/product/supplier/dates/weights/cost/idempotency; writes batch and received movement/audit. | compliance-inventory action; migrations; inventory gates | Architecture records multiple overload debt historically; exact deployed overload set not freshly probed. |
| WF-15 | **Correct delivery mistake** — admin stock count or manual adjustment sets true remaining with reason and compensating movement; intake idempotency prevents duplicate arrival. | stock-count and adjust RPC | No edit/reverse-delivery screen; supplier/date/cost correction is limited (cost via reconcile). |
| WF-16 | **Record waste** — operator chooses product/amount/reason/photo; adapter finds matching active batch then manager RPC writes waste event, negative movement and audit; “review” creates alert. Admin records against a named batch. | waste actions/RPC; workflow unit tests | Operator auto-selects a batch; optional evidence; no offline queue. |
| WF-17 | **Correct waste mistake** — current ledger cannot edit; owner can review reason alert and can correct remaining stock through count/adjust. | append-only trigger; reconcile action; adjustment RPC | No dedicated inverse-waste event UI; “Open full details” is not a correction wizard. |
| WF-18 | **Insufficient stock** — collection consumes available kg and records `completed_with_shortfall`, shortfall detail/audit and owner alert; sale remains collected. | depletion RPC; migration `202607111100`; shortfall guard | Alert has no general resolve/action UI. |
| WF-19 | **Oversell** — same as WF-18; balance floors at zero and never hides short quantity. | implementation/test as above | Online availability is not reserved, so oversell can occur. |
| WF-20 | **Change product price** — admin edits price; server validates and manager RPC changes it with audit. Cutting guide can atomically commit price+cost. | admin products/actions/RPC | No scheduled/future price; public sees latest active data. |
| WF-21 | **Add/disable product** — add form or edit availability/stock status; public catalogue reflects it. | admin product E2E | Categories are selected from existing records; no deletion UI. |
| WF-22 | **View Today priorities** — owner/manager opens `/admin/today`; snapshot builds morning text, up to 3 Do now, Later, week and links. | Today/owner brain; unit and E2E tests | Human comprehension/time not measured; data failure yields degraded message. |
| WF-23 | **Review owner alerts** — owner opens Owner Away card/page; unresolved latest 20 are shown with severity/summary. Reconcile separately loads cost/waste-review kinds. | owner-away/reconciliation services | No single alert inbox route, filters, age/expiry or per-alert link. |
| WF-24 | **Respond to owner alert** — delivery-cost alert can be claimed then cost saved; waste reason can be confirmed; `resolved_at` preserved and audit written. | reconcile action | Other alert kinds, including shortfall/help, have no resolution control. |
| WF-25 | **Operate while owner away** — owner toggles; window begins at `away_since`; operator works normally; owner manually views aggregate. | owner-away action/service | No automated daily dispatch; no real absence drill. |
| WF-26 | **Get help** — operator chooses fridge/ran-out/equipment/unsure/other, optional note, tells owner; durable warning/critical alert; calm confirmation. | help flow/action/tests | No phone call/SMS guarantee; contact details are not shown to operator. |
| WF-27 | **Escalate “I cannot do this”** — Help, critical checklist skip and stock/waste uncertainty create owner alerts/audit and often allow workflow to continue. | escalation adapter and actions | Required numeric checklist readings still block final completion; owner availability unknown. |
| WF-28 | **Recover from operator error** — before save use Back/Change; retry completed run returns existing result; header-only sale repair inserts missing equal-subtotal items or escalates mismatch; after save owner corrects through ledger paths. | serve repair code/tests; runId logic | No general undo; intermediate delivery/waste form state is browser-local. |
| WF-29 | **End-of-day reconciliation** — closing captures till total and confirmations; owner can view revenue/waste and reconcile delivery cost/waste reasons. | closing checklist; admin/reconcile | No computed expected cash/card split versus counted till; no close variance. |
| WF-30 | **Backup generation** — daily GitHub workflow runs REST export and, when DB URL exists, full pg_dump schema/data/auth/storage metadata/roles, encrypts AES-256-GCM, checks artifact and uploads 90-day artifact; full run stamps freshness ledger. | workflow/scripts/runbook | Current scheduled run freshness not probed; storage object bytes excluded. |
| WF-31 | **Empty-database restore** — decrypt archive; bootstrap Supabase prerequisites; restore schema/data with triggers controlled; validate objects/RLS/auth/profile/storage metadata/business paths. | `VERIFIED_DRILL`: recovery runbook 2026-07-13 | Exact standalone machine log/artifact is not committed. |
| WF-32 | **Destructive recovery drill** — deliberate orders 9→0, recover encrypted backup alone 0→9, compare post-recovery hash to pre-disaster. | `VERIFIED_DRILL`: recovery runbook | Prod-equivalent, not a destructive production drill. |
| WF-33 | **Order lookup/status** — customer supplies ref+phone, privileged RPC returns access id, signed cookie grants status/cancel. | public access services; safe-test-order E2E | Support phone handling outside system. |
| WF-34 | **Physical stock count** — start, enter count per batch, record line without mutation, optionally apply variance with reason, stale-system guard, finish. | StockCount/RPC; ops-capture E2E | Kg batches only; no barcode/count units. |
| WF-35 | **Supplier certificate maintenance** — manager records certifier/number/expiry/document URL/verified status and verifies today. | admin compliance/action/RPC | Document URL entry is not necessarily file upload; automatic expiry owner alert absent. |
| WF-36 | **Paper/photo evidence** — operator uploads accepted image to private bucket through server action, record links to run/business row; manager views signed URL/deletes when allowed. | evidence migration/actions/UI | Upload failure shown; no offline retry; full binary excluded from logical DB backup. |
| WF-37 | **Carcass intake/pricing** — manager chooses species/intake values, computes yield/prices, reviews real cuts/mappings and confirms intake/batches/product updates. | cutting guide/components/actions/migration; E2E | Too complex for operator; physical cut accuracy not observed. |
| WF-38 | **Manage collection schedule** — manager creates/edits/toggles windows/capacity and adds/removes closed date; checkout respects it. | schedule actions/E2Es | No recurring holiday calendar or supplier schedule. |
| WF-39 | **Pricing sign-off** — manager reviews generated pricing validation and marks approved/changes required with note/reviewer. | pricing validation route/action/migration | Evidence of real butcher sign-off in production unknown. |
| WF-40 | **Release/health review** — owner views deployment ledger/migration health and can certify completed verification; health API returns build, full manifest parity and backup freshness. | releases route/actions; health route; release gate tests | Technical surface, no Today backup badge; current live state not probed. |

## 8. Screen-by-Screen Behaviour Inventory

Shared facts: staff routes have loading through server rendering but few explicit `loading.tsx` files; no service worker/offline write queue was found (`UNKNOWN` degraded network beyond counter polling). Public/admin/operator global and local error boundaries offer retry/home; operator controls generally meet 64–72px targets and use semantic labels. Full WCAG testing is `UNKNOWN`; keyboard/screen-reader behaviour is only code-inferred. `[VERIFIED_IMPLEMENTATION: error.tsx files, CSS/components]`

| Screen(s) | Purpose, headings and controls | Typing/judgement, confirmation, undo/navigation | States/help/accessibility evidence |
| --- | --- | --- | --- |
| Operator home | Five tiles: Open Shop, Serve Customer, Stock/Delivery, Paper Photo, Close Shop; Help/Call Owner; one lead tile | no typing; decide task; links only | done/lead state; no data error UI; `operator/page.tsx` |
| Operator open | “Open the shop”; 5 sequential steps; Save/Yes/Not now | temp+float numeric; critical judgement; finish confirmation; local redo before finish; Back | persisted resume/done/error; owner escalation; large controls; no offline |
| Operator close | “Close the shop”; 6 steps | till+temp numeric; confirmations; same recovery | same evidence |
| Operator serve | product tiles/custom name, amount/custom price, add more, cash/card, review/save | numeric entry and optional custom typing/price; Change/Back before final; no post-save undo | busy/error/done; shortfall/owner result; no offline; serve component |
| Operator stock | arrived/ran out/waste/not sure; product/amount/supplier/storage/expiry/photo/review | quantity numeric; defaults reduce memory; Change buttons; optional photo; no post-save undo | in-flow errors, owner escalation, Back/Home; component/action |
| Operator waste | no waste or product/amount/reason/photo/review | numeric amount, reason choice; optional photo; no undo after save | error/done; owner review for uncertain reason |
| Operator certificate | Halal/supplier/fridge/other then image | image selection only; upload is confirmation | error/done; creates review; no explicit empty state |
| Operator help | problem choice, optional note, Tell owner | up to 200 chars; one final action | calm done/error; this is escalation path |
| Counter orders | “Orders”; connection badge, refresh, columns/cards, status buttons, cancel, notes | internal note typing; status judgement; cancel browser confirm; no status undo | empty columns, polling fallback, errors, realtime tests; no offline |
| Counter detail | status/ref/customer/date/items/notes | read-only | notFound/back; no action/help |
| Counter compliance | temperature entry and completion checks | several numbers/booleans/notes; validation before complete; no undo | honest unavailable/empty/errors/notices; labelled fields |
| Today | greeting/date/status; Owner Away/reconcile banners; morning briefing; Do now/Later/week/more | choose action; no data typing; actions navigate, do not mutate | configured/empty/error banners; owner-only links filtered; no alert action |
| Today decision | standard what/why/owner/due/evidence card | judgement then follow target | invalid id redirects; back link |
| Today walk | step through action list | next/back; progress browser-only; no “done” write | empty redirects to Today; finish message |
| Admin analysis hub | 5 snapshot KPIs, expandable business panels, tools | substantial reading/judgement; no direct mutation | truth-state banner; complex/mobile burden unknown |
| Admin open/close | same checklist definitions in denser GuidedChecklist | numeric/confirm/skip/action links; persisted receipt | error/resume/receipt; manager route |
| Stock count | per-batch actual kg, record then apply correction with reason, finish | repeated numeric typing and correction judgement; correction explicit | stale protection/errors/empty/done; no undo, ledger compensation |
| Reconcile | delivery cost input, waste review, link-out cards | cost typing/review; claim-on-submit; no undo, but failed follow-on reopens alert | empty tray/errors; only selected kinds |
| Inventory | expiry metrics, add-stock form, batch cards and waste form | many dates/numbers/text fields; explicit Confirm stock/Record waste | safe errors/empty; idempotency note; count exit |
| Purchasing | recommendations, readiness, seasonal tasks, margin | reading/judgement, no write | empty/data quality guidance; links to work |
| Products | add/edit name, unit, category, price, description, stock status/availability | many fields; Save/availability buttons; no delete/undo | inline feedback; E2E public reflection |
| Orders history | order list/history and Counter link | read-only | empty state; overlaps Counter |
| Supplier compliance | status counts, supplier cards, cert form/verify | text/date/URL/notes and compliance judgement | missing/expired warnings, feedback; no generic owner alert |
| Evidence | latest evidence cards, open signed file/delete | delete judgement; destructive button; server enforces `canDelete` | empty/error via page boundary; status labels |
| Owner Away | toggle and panels for open/close/sales/stock/paperwork/alerts/photos | one toggle plus interpretation; no alert resolution | configured/headline/empty facts; owner-only |
| Cutting guide | animal/cost/weight/hanging/yield inputs, result cards, cut drawers, product mapping, intake confirm | highest typing/numeric/judgement burden; final confirm; collapsible advanced controls | validation/errors; mobile E2E; no operator help |
| Pricing validation | validation list, approve/changes required/notes | professional judgement and typing | unavailable state and feedback |
| Pickup windows | list/add/edit/toggle label/times/capacity/days | repeated typing; save/toggle; no deletion | feedback/empty; E2E validation |
| Shop closures | date/reason/add/remove | typing; remove is immediate button, no visible confirm | feedback/empty; E2E persistence |
| Settings | address, SMS template, minimum order/cutoff settings | typing and template placeholder judgement; Save | validation preview/feedback |
| Setup | grouped automatic/manual readiness items, launch-safety owner panel | reading/follow links; cannot tick manual items | status icons; no persisted acknowledgement |
| Guide/playbooks | everyday instructions and dry run | reading only | static; back paths; no completion tracking |
| Audit | filters and immutable event cards | search/filter judgement; no mutation | empty list; owner-only |
| Releases | migration health, release cards, verification updates/certify | technical judgement/notes; certification final | feedback/empty; owner-only |

## 9. Domain and Data Model

The current repository schema contains 49 public tables according to the latest recovery drill, plus Auth/Storage schemas; the creation migrations below identify the operational entities. `[VERIFIED_DRILL: recovery runbook]`

| Entity | Plain-English truth, relationships and mutation | Mutability/attribution/correction/UI understanding |
| --- | --- | --- |
| Branch/config | `branches` owns branch settings, categories, products, schedules and nearly every business row | mutable configuration; owner/manager actions; shown across settings/setup |
| Profiles/roles | Auth user links to profile, branch, staff/manager/owner and `operator_mode` | owner-managed/documented provisioning; actor IDs join audit/events; role UI mostly implicit |
| Products/categories | catalogue definition, unit (`kg/each/box`), current price/cost/availability; order items snapshot name/unit/price | mutable via controlled product RPCs; price audit; past orders retain snapshots |
| Orders/items | order header has customer or null walk-in identity, lifecycle, pickup, subtotal, payment method; items belong to order | status mutable only through state RPC; cancellation fields; items effectively immutable after creation; Counter/customer/admin explain status |
| Status history/notes/SMS | append-like `order_status_events`; internal `order_notes`; `sms_log` outcomes | actors/timestamps; status history not directly rendered as a timeline; notes visible on Counter |
| Payment | only `orders.payment_method` (`cash/card/online`) and subtotal; no payment transaction/state table found | method set on operator sale; no reversal or terminal proof; owner cannot derive actual tender settlement |
| Inventory batches | physical kg receipt by product/supplier/date/expiry/cost/remaining and trace fields | remaining is mutable cache under RPC; corrections append movements; batch cards understandable but ledger explanation requires audit |
| Inventory movements | signed append-only ledger with before/after/source/reason/order/item/idempotency/reversal links | authoritative change history; actor derived; compensating rows only; no full ledger UI, audit/stock UI show summaries |
| Depletion/reversal | one `order_inventory_depletions` summary per order/source; `inventory_reversal_groups` groups compensating movements | exactly-once; shortfall explicit; reversal has no UI |
| Waste | `inventory_waste_events` identifies batch/product/kg/reason; paired movement is stock truth | event append, correction via new movement/count; shown in inventory/analysis |
| Deliveries | represented by inventory batch intake and RECEIVED movement; operator workflow/evidence supplements it | idempotent batch; cost may be pending; no purchase-order entity |
| Compliance | daily `compliance_logs` + readings; supplier and supplier documents/cert metadata | readings/checklist are attributable; supplier config mutable; shown in Counter/Admin |
| Opening/closing | versioned definitions/steps, daily sessions, append-like step events and persisted completion metadata | resumable; actor/branch/version retained; receipts understandable in UI |
| Stock count | session plus per-batch line records system versus counted weight and correction movement | count alone does not mutate; apply is auditable and stale-guarded |
| Audit | `audit_logs` and older `audit_events` both exist; append-only triggers and trusted emitters | immutable to app roles; `/admin/audit` reads recent audit events; dual audit tables are a conceptual complexity |
| Owner alerts | severity, kind, summary, entity reference, creator, resolved timestamp | mutable only to stamp/reopen resolution through server service paths; no acknowledgement/expiry; partially understandable in Away/Reconcile |
| Intelligence | no primary “AI” table; calculations read orders/items/batches/waste/suppliers into findings/actions/briefings | generated on request; scored evidence stripped before operator UI; not durable history |
| Operator workflows/evidence | workflow runs give idempotency/resume result; evidence table points to private Storage object and business source | runs mutable to completed; evidence can be linked/reviewed/soft-deleted; UI exposes signed URL |
| Recovery | `ops_backup_runs` is append-only freshness ledger; older `recovery_drills`/`recovery_artifacts` store drill certification metadata; GitHub artifacts hold encrypted bundle | scripts/service role write; health shows freshness, releases show governance; object bytes separate |
| Carcass/pricing | carcass intake/cuts and pricing validation capture yield/cost/sign-off | confirmed intake creates durable records/batches; manager UI explains estimates and real cuts |

`inventory_movements`, not `inventory_batches.remaining_weight_kg`, is the documented ledger of record; remaining weight is a transactionally maintained, reconcilable cache. `[VERIFIED_IMPLEMENTATION: migration 202606090900; reconciliation views]` Each/box products do not currently map to kg depletion and therefore are catalogue/order truth without complete physical inventory lineage. `[VERIFIED_IMPLEMENTATION: deplete_order_inventory filters kg; serve adapter rejects each/box]`

## 10. Business Rules and Invariants

| Invariant ID | Business rule | Enforcement location | User-visible consequence | Validation evidence | Current status |
| --- | --- | --- | --- | --- | --- |
| INV-01 | Order totals use server catalogue, not browser prices | `create_checkout_order` | honest subtotal or rejection | checkout integrity/tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-02 | Same checkout key+payload creates one order; changed payload rejects | unique key+fingerprint+RPC race path | retry returns same order | checkout validation/integrity | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-03 | Pickup capacity is locked under concurrency | checkout RPC `FOR UPDATE` | full window rejects | integrity script | VERIFIED_TEST (dated report) |
| INV-04 | State graph is incoming→prepping→ready→collected, with pre-collection cancel | `transition_order_status` | invalid move fails | order-state tests/RPC | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-05 | Collection depletes inventory in same transaction | transition calls deplete | collected implies success/explicit shortfall | DB tests/report | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-06 | Each collection depletes at most once | unique `(order_id,source_event)` and idempotency | retry safe | collection-stock/inventory guards | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-07 | Stock never becomes negative | checks, row locks, min/floor | shortfall instead of negative | inventory guards | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-08 | Consumption is deterministic FEFO | expiry/received/id ordering, locked batches | soonest-expiring kg consumed | migration/docs/guards | VERIFIED_IMPLEMENTATION |
| INV-09 | Each/box is not silently treated as kg | depletion/serve filters | owner escalation or non-weight count | serve tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-10 | Every stock change has signed before/after, source and actor/reason | movement schema/RPCs | correction can be traced | truth-hardening tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-11 | Movement/audit history is append-only | mutation-prevention triggers + grants | no edit/delete; compensate | truth-table/inventory guards | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-12 | Stock count alone does not change stock | record then separate apply RPC | operator reviews variance | ops-capture E2E | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-13 | Applied count refuses stale system weight | `STALE_STOCK_COUNT` check | recount message/error | stale-count guard/tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-14 | Reversal is once per order+reason and compensating | reversal group unique key | original sale rows remain | truth-hardening tests | VERIFIED_IMPLEMENTATION; no UI |
| INV-15 | Oversell creates shortfall evidence and owner consequence | depletion summary/audit + `raise_shortfall_owner_alert` | Away shows warning | shortfall guard | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-16 | Failed operation must not report success | actions await writes; checkout partial-success typed state | error or explicit placed/recovery message | failure/action tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-17 | Completed operator run is idempotent | runId/resultRef/readCompletedRun | “Already saved” | workflow code/tests | VERIFIED_IMPLEMENTATION; uneven E2E |
| INV-18 | Required numeric opening/closing evidence cannot be skipped to finish | migration `202606291000` + client blocker | shop cannot finish ritual | required-compliance guard | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-19 | Operator-mode account cannot enter admin/counter | middleware/route access | redirected to operator | route-lock guard/tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-20 | Owner brain exposes no score/confidence/ranking | conversion boundary/firewall | plain action only | owner-brain tests/guards | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-21 | Cancelled/test orders do not count as sales | dashboard/intelligence/away filters | owner totals exclude them | domain tests/source | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-22 | Customer order reference alone grants no access | legacy redirects; ref+phone establishment; signed cookie | lookup required | safe-test-order/import tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| INV-23 | Recovery must restore schema and critical row identity | restore script/validation/hash drill | certified drill evidence | recovery runbook | VERIFIED_DRILL |
| INV-24 | Health is not healthy with unknown build, drift or stale/absent full backup | health aggregation | DEGRADED/503 when non-serving state | build/migration/backup tests | VERIFIED_IMPLEMENTATION; VERIFIED_TEST; live state UNKNOWN |
| INV-25 | Owner can determine why every displayed aggregate changed | audit/movement sources exist | not always directly linked from metric | code inspection | CONFLICTED — data exists, UI trace is incomplete |

## 11. Inventory Reality Model

- **Product versus stock.** Product is a sellable catalogue definition; physical truth exists only where kg batches exist. `stock_status` is a catalogue flag, while batch remaining/movements are physical truth. `[VERIFIED_IMPLEMENTATION: products; inventory_batches/movements]`
- **Batch creation.** Admin intake supports product, supplier, received/expiry date, expected/actual/remaining kg, cost, halal/country/slaughter/storage/batch fields and idempotency. Operator intake supports kg, defaults and optional photo, always queues missing cost. `[VERIFIED_IMPLEMENTATION]`
- **Weights/units.** Physical engine is kg with three decimals; order catalogue also permits each/box. Partial kg is supported. Each/box conversion is `NOT_MODELLED` in current depletion. `[VERIFIED_IMPLEMENTATION]`
- **FEFO.** Active batches are consumed by expiry, received date and UUID under row locks; multiple batches can fulfill one line. `[VERIFIED_IMPLEMENTATION: deplete_order_inventory]`
- **Trimming/cutting.** Waste reason `trim_loss` exists; carcass intake models expected/actual cut weights and product mappings. Continuous transformation from carcass→primal→retail cut as a live chain is only partly modelled through intake/cuts/batches, not a general conversion ledger. `[VERIFIED_IMPLEMENTATION] [INFERRED]`
- **Delivery discrepancy.** Expected versus actual fields and review notes exist; operator uncertainty/cost gaps create owner alerts. Supplier invoice matching and delivery-order variance are `NOT_MODELLED`. `[VERIFIED_IMPLEMENTATION]`
- **Spoilage/waste.** Expired/damaged/trim/customer/other reasons reduce a chosen batch and retain event+movement; owner intelligence values waste using batch/product cost. `[VERIFIED_IMPLEMENTATION]`
- **Substitution.** `NOT_MODELLED`; orders retain fixed item snapshots. `[UNKNOWN after repository search]`
- **Manual adjustment/reconciliation.** Manager RPC and stock count append `MANUAL_ADJUST`/`COUNT_RECONCILE`, preserve before/after/reason and reject stale counts. `[VERIFIED_IMPLEMENTATION]`
- **Oversell.** Online orders do not reserve. On collection, available kg is depleted, missing kg is recorded, stock floors at zero, audit+owner alert are created. `[VERIFIED_IMPLEMENTATION]`
- **Confidence.** reconciliation views produce internal score/reasons and operator signal `trusted/count_soon/count_today`; UI strips score and routes low confidence to Count only. `[VERIFIED_IMPLEMENTATION] [VERIFIED_TEST]`
- **Evidence.** Photos are optional for delivery and waste, not a universal requirement. Operator evidence records source/link/review state; Storage object bytes are outside logical DB backup. `[VERIFIED_IMPLEMENTATION]`
- **Owner visibility.** Inventory, stock-count, Today, purchasing, analysis, evidence, Away and audit expose different slices; there is no single event-to-physical-item trace screen. `[VERIFIED_IMPLEMENTATION]`
- **Not modelled/unknown physical scenarios.** catch-weight each/box, substitutions, transfer between locations, recall workflow UI, supplier purchase orders, barcode/scale integration, yield loss after batch creation, stock held for uncollected orders, and actual daily fridge-to-system reconciliation are `UNKNOWN` or `NOT_MODELLED`.

## 12. Orders, Payments and Customer Service Model

Online orders use a server-authoritative checkout and start `incoming`; walk-in operator sales are created without customer identity and immediately traverse to `collected`. Items snapshot the name, unit, unit price and line total. Counter staff move online work through `incoming → prepping → ready → collected`; cancellation is available from the first three states to staff and from `incoming` to a verified customer within the configured window. `[VERIFIED_IMPLEMENTATION: orders RPCs/routes]`

There is no online charge. Customer copy says the total is checked and paid through the shop till/card reader. Walk-in orders record only `cash` or `card`; there is no payment status, amount tendered, change, terminal transaction ID, failure, partial payment or settlement table. `[VERIFIED_IMPLEMENTATION]` Consequently “cash/card revenue” can only be inferred for walk-in orders with a populated method; online-order tender at collection is not captured. `[INFERRED]`

Preparation, ready messaging, status lookup and customer cancellation exist. Refund has a stock reversal RPC only; no money workflow or UI. Partial refunds/payments, substitutions, amendments, no-show handling, duplicate-customer merge and receipts are absent. Duplicate order submission is explicitly controlled by idempotency. Price changes do not rewrite existing order snapshots. `[VERIFIED_IMPLEMENTATION] [VERIFIED_TEST]`

Reconciliation currently shows total/revenue estimates and closing till count, not an expected-versus-actual payment split. Customer support exceptions end in “call the shop”; there is no support case entity. `[VERIFIED_IMPLEMENTATION]`

## 13. Owner Brain, Alerts and Decision Support

The morning system is request-time computation, not a stored briefing. `getOperationalSnapshotV1` assembles metrics/intelligence, `buildOwnerBrain` ranks internal decisions, `compressActions` selects at most three Do Now actions, `toOperatorAction` removes scores/evidence, and `buildMorningBriefing` produces Yesterday/Today/Ignore sentences. Today shows a weekly wins/risks/opportunities summary and direct action targets. `[VERIFIED_IMPLEMENTATION: owner-brain modules] [VERIFIED_TEST: owner-brain tests]`

Alerts are durable `owner_alerts` rows with warning/critical, arbitrary kind, summary, entity reference, creator, created time and optional resolved time. Sources include help, critical checklist skip, unknown/uncertain delivery and waste, missing delivery cost, questionable sale, low stock during sale and inventory shortfall. Deduplication is only “same open entity_ref” in the adapter and per-order open shortfall in its trigger. `[VERIFIED_IMPLEMENTATION]`

There is no `acknowledged_at`, expiry, snooze or generic action URL. Only reconciliation kinds are actionable/resolvable in the UI. Owner Away shows the latest 8 of up to 20 queried unresolved alerts; completed reconcile alerts disappear from the open tray but rows remain. Help/shortfall alerts can accumulate without a UI resolution path. `[VERIFIED_IMPLEMENTATION]`

After one day, Away (when off) uses start of current UTC day; after one week with Away on, it uses `away_since`, but query limits cap orders 20, workflows 50, evidence/documents/batches 50, movements 200 and alerts 20. Counts derived from capped result sets may undercount a busy long absence. `[VERIFIED_IMPLEMENTATION: owner-away.ts]` There is no scheduled daily summary sender or proof the owner receives anything without opening the app; V17's dispatch promise is `DOCUMENTED_ONLY`.

Metrics/thresholds include top-three action compression, expiry bands, customer cadence, material waste and inventory-confidence thresholds in source modules. Explainability is available through action detail/supporting facts, while internal scoring is intentionally hidden. Stale/failed data returns explicit configured/error states rather than demo data in production. `[VERIFIED_IMPLEMENTATION] [VERIFIED_TEST]`

## 14. Opening, Closing and Daily Operating Rhythm

| Moment | Current behaviour | Mode |
| --- | --- | --- |
| Before opening | Owner may view Today/setup; no automatic wake-up or scheduled briefing | manual/request-time |
| Opening | 5-step fixed ritual; fridge temp and float numeric; certificate/display/sign confirmations; critical skip alerts | system-guided |
| First/ordinary customer | Walk-in uses operator kg sale; online work appears on Counter | guided/manual |
| Delivery arrival | Operator kg flow or detailed admin intake; missing cost queued | system-guided |
| Low-stock/oversell | owner-brain/purchasing guidance; collection shortfall owner alert | automatic signal + manual response |
| Waste | operator/admin flow writes event and movement | guided |
| Operator mistake | before-save Back/Change; after-save owner count/correction | mixed |
| Customer exception | cancellation within rules; otherwise call shop | guided/external |
| Owner intervention | manually opens Today/Away/Reconcile/target screen | manual |
| End of day | close ritual asks waste logged, stock glance, till, cold, clean, lock | system-guided with external physical acts |
| Closing | completed receipt; no automatic financial variance | system-guided/absent reconciliation |
| Next morning | briefing calculated from current data when Today opens | request-time, not pushed |

`[VERIFIED_IMPLEMENTATION: checklist definitions; operator/admin routes; owner brain]` Whether the real shop follows this rhythm is `UNKNOWN`.

## 15. Failure and Recovery Behaviour

| Failure | Current user consequence and recovery | Evidence state/source |
| --- | --- | --- |
| Connection/database | public surfaces show data-not-ready; counter has realtime→polling; staff actions return safe errors; error boundaries offer retry/home | VERIFIED_IMPLEMENTATION; no offline field test |
| Server action/validation | field or generic plain error; operation is not shown done; validation safe fragments are surfaced | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| Duplicate submit | buttons disable; checkout keys/fingerprints and operator run IDs prevent duplicates | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| Stale screen | Counter refetches; stock count rejects stale batch; other admin forms may return “already”/failure | VERIFIED_IMPLEMENTATION; UNKNOWN for other admin stale-state recovery |
| Partial checkout | order may be placed while access-cookie establishment fails; response says placed and routes to lookup | VERIFIED_TEST: checkout action tests |
| Abandoned workflow | checklists resume from DB; completed operator runs retry safely; intermediate serve/stock/waste screens are browser-local | VERIFIED_IMPLEMENTATION; known gap |
| Incorrect input | validation blocks; pre-confirm Back/Change; post-confirm correction is owner work | VERIFIED_IMPLEMENTATION |
| Owner unavailable | workflow can continue for many escalations; critical required readings block open/close; alert is durable but no guaranteed recipient channel | VERIFIED_IMPLEMENTATION |
| Printer/terminal | printer not modelled; terminal is external and payment result not captured | UNKNOWN; NOT_MODELLED |
| Insufficient inventory | collect succeeds with explicit shortfall and alert; never negative | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| Simultaneous actions | checkout/window and depletion use locks/idempotency; alert resolution uses compare-and-swap; general admin edits have ordinary last-write risk | VERIFIED_IMPLEMENTATION |
| Image upload | accepted types/size enforced; action can mark failure/show retry; no offline queue | VERIFIED_IMPLEMENTATION |
| Delivery/waste save | error remains on form; completed run avoids duplicate; uncertain data escalates | VERIFIED_IMPLEMENTATION |
| Opening/closing save | start/step/finish errors shown; resume possible; required readings block finish | VERIFIED_IMPLEMENTATION; VERIFIED_TEST |
| Backup | if the full workflow fails, it writes no full freshness success; health/release gate degrade/block | VERIFIED_IMPLEMENTATION; VERIFIED_TEST; live state UNKNOWN |
| Restore validation | script exits non-zero on object/RLS/auth/profile/business validation failure; drill documentation records passing run | VERIFIED_DRILL |

## 16. Observability for the Business

| Owner question | Current answer/source | State |
| --- | --- | --- |
| Is shop open/who opened? | Away open status and checklist session `started_by/completed_by`; receipt metadata; audit | VERIFIED_IMPLEMENTATION — UI does not prominently name opener in Away |
| Temperatures recorded? | Counter compliance day/readings; checklist receipts; audit | VERIFIED_IMPLEMENTATION |
| What sold today? | Counter/admin orders; analysis order/product metrics | VERIFIED_IMPLEMENTATION |
| Cash taken? | only walk-in orders whose `payment_method=cash`; no dedicated visible split | CONFLICTED — field exists but reporting and coverage are incomplete |
| Card revenue? | same limitation | CONFLICTED — field exists but reporting and coverage are incomplete |
| Incomplete orders? | Counter columns and dashboard awaiting/ready counts | VERIFIED_IMPLEMENTATION |
| Low stock/expiry? | Today, purchasing, inventory expiry, confidence guidance | VERIFIED_IMPLEMENTATION |
| Waste? | inventory, analysis, Away | VERIFIED_IMPLEMENTATION |
| Why stock differs? | stock-count line, movement reason, audit/reconciliation views | VERIFIED_IMPLEMENTATION — fragmented UI |
| Owner intervention? | Away unresolved alerts, reconcile tray, Today actions | VERIFIED_IMPLEMENTATION — no complete inbox |
| What changed while away? | Away summary since `away_since` | VERIFIED_IMPLEMENTATION — query caps apply |
| Did workflow fail? | failed evidence/open alerts/logs; no durable general workflow-failure dashboard | CONFLICTED — evidence sources exist but no complete failure view |
| Trace correction? | movement/audit IDs and reversal links | VERIFIED_IMPLEMENTATION — limited UI |
| Is today's data complete? | checklist/compliance states and data-state banners; no single completeness certificate | CONFLICTED — component states exist but no complete certificate |
| Is backup current? | `/api/health.backup` and release gate | VERIFIED_IMPLEMENTATION; UNKNOWN live state |
| Last recovery test? | recovery runbook/certification docs, not normal owner screen | VERIFIED_DRILL — not visible in business UI |

## 17. Reporting and Business Measurement

| Measure | Status | Formula/source/evidence |
| --- | --- | --- |
| Sales/revenue/order count | implemented and visible | non-test, non-cancelled order subtotals/count; dashboard/operations intelligence |
| Payment split | implemented field but not visible/complete | `orders.payment_method`; no report and online collections unset |
| Average order/basket value | implemented and visible | revenue/order or customer/basket builders |
| Stock quantity/value | implemented and visible for kg batches | remaining kg; at-risk kg × cost |
| Waste quantity/value | implemented and visible | waste movement/event kg × resolved batch/product cost |
| Margin/gross profit | implemented and visible when all costs known | revenue − inventory cost − waste cost; null/honest message when cost missing |
| Net profit | absent | no overhead/labour/tax model |
| Supplier performance | documented readiness/compliance only; delivery quality absent | purchasing readiness + supplier cert status |
| Expiry | implemented and visible | days between now and batch/cert expiry |
| Customer demand/return | implemented and visible | 120-day orders grouped by phone, cadence, repeat rate, product pairs |
| Product performance | implemented and visible | order item revenue, estimated costs and waste drag |
| Operator performance | absent by design | actor/workflow records exist, no performance report |
| Compliance | implemented and visible | daily logs/readings and certificate bands |
| Exceptions | incomplete | owner alerts, failed SMS, shortfalls, audit; no unified report |
| Recovery status | implemented API/documentation, not business UI | backup freshness ledger/health + runbook drill |

All formulas are request-time calculations in `src/lib/domain/operations-intelligence.ts`, `src/lib/server/operations-intelligence.ts`, dashboard and owner-away services; there is no reporting warehouse. Query windows/caps mean these are operational estimates, not statutory accounts. `[VERIFIED_IMPLEMENTATION]`

## 18. Disaster Recovery Current Truth

| Item | Current evidence record | State |
| --- | --- | --- |
| Backup source | workflow uses REST core export plus full logical `pg_dump` of public schema/data, auth, storage metadata and roles | VERIFIED_IMPLEMENTATION: workflow/scripts |
| Backup date | latest drill documented 2026-07-13; exact artifact timestamp not committed | VERIFIED_DRILL; UNKNOWN exact timestamp |
| Format | single encrypted `*.backup.enc`, manifest and SHA-256 checksums; no raw SQL left | VERIFIED_IMPLEMENTATION; VERIFIED_DRILL |
| Encryption | AES-256-GCM, scrypt-derived key (`aes-256-gcm-scrypt-n16384`) | VERIFIED_IMPLEMENTATION; VERIFIED_DRILL |
| Integrity | encrypted checksum plus decrypt round-trip; row md5 comparisons | VERIFIED_DRILL |
| Restore target | fresh empty Postgres database with required Supabase prerequisites | VERIFIED_DRILL |
| Empty start | yes, bare `CREATE DATABASE` in latest drill | VERIFIED_DRILL |
| Objects restored | 49 tables; RLS 49/49; 70 functions; 56 policies; 25 triggers; 4 views | VERIFIED_DRILL: recovery runbook |
| Critical parity | byte-identical md5 of orders, order_items, products, audit_logs, inventory_movements, order_status_events, compliance_readings | VERIFIED_DRILL |
| Destructive corruption | orders deliberately 9→0 | VERIFIED_DRILL |
| Recovery rows/hash | orders 0→9; recovered hash equals pre-disaster | VERIFIED_DRILL |
| RTO | about 4 seconds decrypt+restore+validate at current single-shop data size; earlier drill estimated 10–15 minutes operationally | CONFLICTED but reconcilable: measured script runtime versus broader operational estimate; both in runbook |
| RPO | daily cadence, best-case ≤24h; no point-in-time recovery documented | DOCUMENTED_ONLY operational characteristic; live freshness UNKNOWN |
| Retention | flat GitHub artifact retention 90 days | VERIFIED_IMPLEMENTATION: workflow; DOCUMENTED_ONLY count approximation |
| Runbook/frequency | `docs/runbooks/ptm-phase1-recovery.md`; says rerun quarterly | DOCUMENTED_ONLY schedule; one current drill evidenced |
| Limitations | Storage metadata but not object bytes; encryption key required; restore scales with rows; current CI freshness not probed | VERIFIED_IMPLEMENTATION; UNKNOWN live state |

Reconciliation: the July 10 master audit's “30/30 failures, no backup, no restore, RTO undefined, 48 tables/66 functions/22 triggers” was true for that observation and is superseded by later backup tooling, workflow fixes and the July 13 drill. The local `docs/reports/disaster-recovery-certification.md` remains explicitly non-launch local test evidence and does not replace the full drill. The specification's reported 49/49, 70, 56, 25, 4, seven tables, 9→0→9, matching hash, ~4 seconds, AES-256-GCM and 90-day retention all match the latest runbook. `[VERIFIED_DRILL]`

## 19. Validation and Test Coverage Map

| Capability | Unit test | Integration test | Database test | E2E test | Drill/manual evidence | Coverage status |
| --- | --- | --- | --- | --- | --- | --- |
| Checkout/idempotency/capacity | validation/action tests | checkout integrity script | checkout RPC guard | checkout + safe-test-order | dated remediation evidence | strong, current UI suite not rerun |
| Customer lookup/cancel | cancellation/order access tests | public import/access checks | public RPC migrations | safe-test-order | screenshots | strong |
| Counter state workflow | order-state domain | counter action/service | transition RPC | persistence/realtime/SMS/notes | command path | strong for seeded stack |
| Operator serve | serve/serve-lines/repair tests | operator scripts | transition/depletion | no stable complete current serve E2E cited | command-path report | gap at browser/task-timing level |
| Opening/closing | progress/default tests | required compliance scripts | ops RPC guards | ops-capture admin skin | command path | operator skin E2E gap |
| Compliance | schema/domain tests | integrity scripts | compliance RPC guard | Counter compliance indirectly | command path | strong backend, limited operator overlap proof |
| Delivery/waste | workflow helper tests | ops scripts | inventory RPC guards | inventory/waste-risk | command path | operator browser gap |
| Inventory FEFO/no-negative/idempotency | collection-stock/truth-hardening | integrity scripts | extensive DB guards | ops stock count | command path | strong |
| Reversal/refund | truth-hardening pure tests | truth-table script | reversal RPC migration | none | none | no user outcome validation |
| Owner brain/Today | many owner-brain/action tests | verify scripts | n/a | owner-brain/v8 | screenshots/proofs | strong logic; human comprehension untested |
| Owner Away/alerts | owner-away/domain tests | shortfall guard | trigger/RPC | none found | source/manual report | general alert response and week absence gaps |
| Products/schedules/admin | domain/action tests | server actions | admin RPCs | products/windows/closures | none | good main paths |
| Carcass/pricing | butchery tests | action | intake RPC | cutting-guide | butcher signoff report | real butcher signoff unknown |
| Failure surfaces | source tests | action tests | n/a | degraded counter tests | none | no weak-network/device exercise |
| Build/migration/backup health | build/migration/freshness/backup tests | release gate | freshness/migration RPC | hosted smoke historically | DR drill | strong code/drill, current live unknown |
| Full restore | backup crypto tests | restore script | scratch validation | n/a | July 13 drill | strong documented drill; artifact/log not committed |

Current local result: 634/634 tests passed, but these Vitest tests do not connect to production. Several E2E files validate old labels such as “Dad Mode” and seeded data; they prove a test environment when run, not current production. Test names like “production certification” in `backup-system.test.ts` validate label/logic functions, not a production restore. Architecture and post-remediation reports explicitly warn that command-path checks are not full browser task proof. `[VERIFIED_TEST] [CONFLICTED: naming can overstate production relevance]`

Implemented behaviour without adequate user-outcome validation: operator serve/delivery/waste/certificate/help on real devices, alert receipt/resolution, owner absence, payment/till reconciliation, refund/reversal, offline uploads, and current deployed build parity.

## 20. Documentation Conflict Register

| Conflict ID | Topic | Source A | Claim A | Source B | Claim B | Current evidence | Resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CF-01 | Backups | Master audit 2026-07-10 | no working production backups | recovery runbook/latest commits | workflow-produced full artifact used for drill | scripts/workflow/runbook | old claim superseded for existence; current freshness unknown |
| CF-02 | Restore | Master audit | no restore demonstrated/RTO undefined | recovery runbook 2026-07-13 | empty restore, parity, destructive recovery, ~4s | drill record | old claim superseded |
| CF-03 | Backup scope | Master audit | 8 public tables only | full backup script/runbook | schema/data/auth/storage metadata/roles | current implementation | old tooling superseded; binary objects still excluded |
| CF-04 | Schema counts | Phase-1 report | 48 tables, 66 functions, 22 triggers | latest drill | 49, 70, 25 plus 4 views | new migration + drill | earlier counts superseded |
| CF-05 | Production migrations | Master audit | 35/38, head 202606300900 | post-remediation addendum | 41/41, head 202607111100 | dated production evidence + repo 41 | old observation superseded; current live still unprobed |
| CF-06 | Health parity | Master audit | curated 11/11 masked drift | current health/manifest | complete 41 manifest | route + generated manifest/tests | old implementation superseded |
| CF-07 | Build identity | Master audit | unknown | closeout addendum | deployed canonical `900db21` | dated evidence; later commits | known then, current unknown |
| CF-08 | Production readiness | master/phase reports | conditional vs controlled pilot | later DR drill | stronger recovery evidence | no current field/device/live probe | do not promote; readiness remains undeclared |
| CF-09 | Oversell owner alert | Master/post report | no owner alert | migration `202607111100` | warning alert per shortfall | implementation + guard | old finding superseded |
| CF-10 | Counter retirement | V16 reality map | counter-mode removed | current `/counter` routes | dedicated Counter active | implementation/E2E | only admin query mode retired; `/counter` remains |
| CF-11 | Operator home count | V17 | 4-button home + optional Help | current home | 5 work tiles including Paper Photo + Help | implementation | spec wording stale |
| CF-12 | Operator certificates | V17 amendment | certificate state is owner/system duty, automatic expiry alerts | checklist/current code | operator opening asks certificates on show; no expiry-alert generator found | source search | requirement implementation is incomplete |
| CF-13 | Owner Away delivery | V17 | daily plain-English message via dispatcher | current service | manually rendered summary only | no scheduler/dispatch caller | specification-only behaviour |
| CF-14 | Alert inbox/actions | V17 phase 7 | owner alerts inbox and rules | current routes | Away list + two-kind reconcile tray, no general inbox | route/action inventory | implementation is incomplete |
| CF-15 | Architecture table count | current architecture doc | all 48 tables RLS | latest drill | 49/49 | drill/migration head | architecture count stale, invariant still holds in drill |
| CF-16 | Reversal workflow | architecture | reversals exactly-once | UI/workflow inventory | RPC exists but no user route/action | source search | database capability, not an operational workflow |

## 21. Unknowns and Evidence Gaps

| Gap ID | Question | Why it matters | What was inspected | Missing evidence | Required future evidence |
| --- | --- | --- | --- | --- | --- |
| GAP-01 | What is the current deployed commit and health state? | repository may differ from live | health route, reports, git log | current live response | dated `/api/health` and deployment record |
| GAP-02 | Is production still at migration 41 and full backup fresh? | live schema/recovery truth | manifest, dated addendum/runbook | current probe/workflow run | read-only migration and backup freshness evidence |
| GAP-03 | Does the actual owner accept/use Today and Away? | core product requirement | doctrines/screens/tests | human behaviour | owner interview and observed tasks |
| GAP-04 | Can Uncle Gul complete a full day accurately and quickly? | low-literacy premise | operator code/screens/command paths | real user timing/errors | observed open→trade→delivery→waste→close rehearsal |
| GAP-05 | Does the shop operate for a week without owner presence? | headline V17 value | Away implementation/spec | field trial and alert receipt | owner-absence pilot evidence |
| GAP-06 | How are online-order cash/card tenders recorded? | revenue/payment truth | payment fields/routes | real till process | shop SOP plus tender reconciliation evidence |
| GAP-07 | Is there a real card-terminal integration/failure procedure? | customer service | code/docs search | hardware/process | terminal model, receipts and outage drill |
| GAP-08 | How are refunds, partial refunds and collected-order mistakes handled? | money and stock correction | reversal RPC/cancel UI | operational UI/SOP | approved refund workflow evidence |
| GAP-09 | Do physical kg counts match PTM after a real day? | inventory usefulness | stock-count/inventory engine | physical reconciliation | blind count versus system report |
| GAP-10 | How are each/box, substitutions and catch weights handled? | butcher reality/recall | unit model/design docs | implemented conversion/SOP | product-by-product inventory policy |
| GAP-11 | Are Storage photo bytes backed up elsewhere? | evidence recovery | full backup/runbook | object export artifact | storage-object restore drill |
| GAP-12 | Does the owner receive critical alerts outside the app? | escalation during absence | alert adapter/dispatcher | configured webhook/SMS and delivery proof | end-to-end alert receipt test |
| GAP-13 | What happens on weak/no network and device failure? | shop continuity | error/polling code | field evidence/offline SOP | weak-network and device-swap drill |
| GAP-14 | Are printer, receipt, scale and barcode processes needed? | counter operation | repo search | hardware requirements | shop observation/interview |
| GAP-15 | Are reporting figures complete enough for the owner's accounts? | business visibility | calculation source/UI | accountant/owner validation and tender data | sample-day reconciliation to external records |

## 22. Audit Readiness Checklist

| Gate | Result | Evidence |
| --- | --- | --- |
| Owner requirements extracted | YES | 30-row register with sources/states |
| Stakeholder model complete | YES | owner, operator, counter, customer, manager/staff |
| All active routes inventoried | YES | 55/55 route handlers, including redirects/APIs |
| All core workflows documented | YES | 40 workflows including all 32 required |
| Screen behaviour captured | YES | every operator/counter/admin route grouped with controls/states |
| Data model captured | YES | operational entities, authority, corrections and UI visibility |
| Invariants captured | YES | 25-rule register |
| Tests mapped | YES | capability coverage map plus overclaim caveats |
| Disaster recovery reconciled | YES | old failure, later tooling and 2026-07-13 drill separated |
| Historical contradictions resolved | YES | 16 conflicts with current resolution |
| Unknowns explicit | YES | 15 material gaps |
| No unsupported current-state claims | YES | live/deployment/field claims marked unknown or dated |
| Audited commit recorded | YES | `f7d4380f12648cf6495675fd0941f519a38d5093` |
| One canonical file produced | YES | `docs/audits/ptm-operational-audit-input.md` |

**Final status: `AUDIT_INPUT_READY_WITH_DECLARED_GAPS`.** The repository, route, workflow, data, invariant, test and recovery evidence is sufficient to design the next operational audit without treating older reports as current truth. The declared gaps materially constrain conclusions about live deployment, real people, physical stock, payments, hardware, weak-network operation and unattended ownership, so the dossier is not gap-free. `[VERIFIED_IMPLEMENTATION] [VERIFIED_TEST] [VERIFIED_DRILL] [GAP-01–GAP-15]`
