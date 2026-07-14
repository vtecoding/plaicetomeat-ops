# PTM known risks (V18 Phase A code, 2026-07-14)

## Must fix before production
- **V18 migrations and application code are repository/local truth until the linked
  production schema and application are deployed through the backup-first release
  runbook.** Verify linked migration history and take a fresh backup before `db push`;
  never infer production parity from a green local reset.
- Phase-A field gates are still evidence work: the reconciliation day and timed Gul
  rehearsal (G-A), real-phone critical alert plus morning digest (G-B1), and the full
  refund/amendment/mistake/tray/Away trial (G-B). Code and synthetic gates do not
  substitute for these shop observations.

## Should fix before wider rollout
- No continuous DB check that orders.subtotal = Σ order_items.line_total (writers
  compute it; collection freezes and tenders the canonical SQL fold). Operator serve
  itself is one `create_operator_serve_order_v18` transaction, with guarded recovery
  only for facts written by the pre-V18 cutover path.
- Twilio's outbound Messages API has no documented client idempotency-key parameter.
  Owner-alert activation therefore requires explicit acceptance of the implemented
  at-most-once boundary: ambiguous provider outcomes become terminal-visible failures
  and are never blindly retried.
- No external telemetry sink (V16 Stream C blocked on owner's sink decision):
  production runtime errors visible only in Vercel logs.
- Config tables (suppliers, pickup_windows, categories, closures, sms_templates,
  branch_settings, branches, release_*) remain direct-writable by managers — partial
  audit coverage, accepted for now.

## Nice to have
- Public storefront pages still carry pre-redesign card styling (cosmetic).
- Duplicate screenshot/audit tooling (audit-dad-usability vs ptm-route-audit) could
  be consolidated (fix plan L2).
- Big binary audit artifacts (audit/, audit-screenshots/, *.zip) are committed to the
  repo history from both audit passes; consider git-lfs or pruning for repo hygiene.
