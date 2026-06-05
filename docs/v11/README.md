# V11 — Consolidation, Security and Launch Hardening

Canonical spec: [`docs/v11-master-spec.md`](../v11-master-spec.md).

This folder holds V11 governance artefacts and per-phase evidence. V11 is a
**hardening release, not a feature release**. A temporary release freeze is in
effect (see [baseline/baseline-freeze.md](baseline/baseline-freeze.md) §4).

## Phase tracker

| Phase | Title | Branch | Status |
|---|---|---|---|
| V11.0 | Baseline Freeze & Reproducibility | `v11-baseline-and-governance` | DONE (this session) |
| V11.1 | Emergency Public Security Boundary | `v11-public-order-access` | IN PROGRESS |
| V11.2 | Audit Authenticity & Privileged Data Access | `v11-audit-authenticity` | not started |
| V11.3 | Checkout & Capacity Correctness | `v11-checkout-concurrency` | not started |
| V11.4 | Checklist & Operational Evidence Integrity | `v11-checklist-invariants` | not started |
| V11.5 | Inventory Reconciliation Integrity | `v11-stock-count-cas` | not started |
| V11.6 | Canonical Owner Operating System | `v11-owner-os-consolidation` | not started |
| V11.7 | One Operational Snapshot | `v11-operational-snapshot` | not started |
| V11.8 | Pricing & Cost Truth | `v11-pricing-provenance` | not started |
| V11.9 | Production Failure Semantics | `v11-observability-and-recovery` | not started |

## Release gates (spec §14)

- **Gate A — P0 Security:** order refs no longer authorise; cancellation requires a
  session; public endpoints rate-limited; audit direct insert revoked; service-role
  public read removed; security headers verified.
- **Gate B — Data Integrity**
- **Gate C — Production Truth**
- **Gate D — Operability**
- **Gate E — Recovery**

Public launch is blocked until Gates A–E are green. See spec Appendix B for the
"Do Not Launch" checklist.

## Working rules for implementing agents (spec §19)

1. Inspect current implementation + tests before changing code.
2. State the invariant being introduced.
3. Identify all callers and data paths.
4. Identify migration + rollback impact.
5. Write adversarial tests first.
6. Never weaken an invariant to preserve a UI shortcut.
7. Do not declare a phase complete from typecheck/build alone.
