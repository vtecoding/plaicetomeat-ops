# PTM known risks (post 2026-07-10 hardening)

## Must fix before production
- **Production DB has NOT received the migrations from phase0 onward** (last prod push
  was the V14 set, 2026-06-10). The phase0/1/2/3 locks, V17 operator mode, and grants
  migrations exist only in the repo + local stack. Until `supabase db push --linked`
  runs (after a backup, per the V15 deploy runbook), production still has the C1
  direct-write doors OPEN. This is the single highest-value pending operator action.
- `production-backup.yml` needs repo secrets (BACKUP_ENCRYPTION_KEY,
  SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, CANONICAL_BRANCH_ID);
  scheduled backups do not run until set.

## Should fix before wider rollout
- Counter-sale creation is multi-step (order → items → status event → collect), not
  one transaction. Mitigated by idempotency + repair-on-retry (serveRepairDecision);
  the stronger end-state is a single `create_counter_sale` SECURITY DEFINER RPC.
- No continuous DB check that orders.subtotal = Σ order_items.line_total (writers
  compute it; a monitor query in inventory_reconciliation_monitor-style would close it).
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
