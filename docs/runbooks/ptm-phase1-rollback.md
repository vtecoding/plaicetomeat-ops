# PTM Phase-1 — Emergency Rollback / Forward-Fix Runbook

The Phase-1 migrations are **expand-safe** (REVOKE grants, DROP permissive
policies, ADD a table + functions). None drop a column, table, or authorized
code path. The preferred response to a problem is almost always **forward-fix**,
not a destructive rollback. Reversal SQL is provided for completeness.

## Fast triage

| Symptom | Most likely cause | Action |
|---|---|---|
| App `/api/health` non-200 after redeploy | app build, not the DB | `vercel rollback` (DB can stay migrated) |
| A legitimate staff/manager write now fails | it was going direct-to-table, not via an RPC | forward-fix: route it through the DEFINER RPC (correct), or temporarily re-grant (below) |
| Checkout / serve fails to get an order ref | unexpected — `next_order_ref` only used by service_role + DEFINER | verify `service_role` retained EXECUTE; re-grant if missing |
| Backup workflow red | owner secrets not set | expected until secrets configured — not a rollback |

## Application rollback (safe, instant, reversible)

```bash
npx vercel ls plaicetomeat-ops --prod          # list deployments
npx vercel rollback <previous-deployment-url>  # promote the prior READY build
curl -s https://plaicetomeat-ops.vercel.app/api/health   # confirm serving
```

The previous build is compatible with the migrated schema (all writes go through
DEFINER RPCs / service role), so an app rollback does **not** require a DB rollback.

## Database forward-fix (preferred)

If a real write path breaks, it was performing a direct client-role table write
that should have gone through the audited RPC. Fix forward by routing it through
the correct `SECURITY DEFINER` function (e.g. `admin_update_product_price`,
`admin_record_inventory_waste`, `transition_order_status`). This preserves the
audit trail the lock exists to protect.

## Database reversal SQL (last resort, per migration)

Apply as a NEW migration (never edit history). Only if forward-fix is impossible.

### Reverse 202607111000 (ops_backup_ledger)
```sql
DROP FUNCTION IF EXISTS public.get_backup_freshness(integer);
DROP FUNCTION IF EXISTS public.record_backup_run(text, text, text, integer, text, text);
DROP TABLE IF EXISTS public.ops_backup_runs;   -- append-only; drop trigger cascades
```
Impact: health `backup_freshness` becomes UNAVAILABLE→DEGRADED (fail-closed). No data-path impact.

### Reverse 202607110900 (next_order_ref revoke)
```sql
GRANT EXECUTE ON FUNCTION public.next_order_ref(uuid, date) TO anon, authenticated;
```
Impact: **re-opens PTM-SEC-003** (anon can advance the sequence). Only do this if
you can prove a legitimate anon/authenticated caller exists (none does today).

### Reverse 202607101200 (phase-3 truth lock) — DANGEROUS
```sql
-- Re-open direct writes (re-introduces PTM-REL-002 forge-ability). Last resort only.
GRANT INSERT, UPDATE, DELETE ON public.products, public.inventory_waste_events,
  public.order_status_events TO authenticated;
CREATE POLICY "managers can manage products" ON public.products
  USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));
CREATE POLICY "managers can create branch waste events" ON public.inventory_waste_events
  FOR INSERT WITH CHECK (public.is_branch_manager(branch_id));
CREATE POLICY "staff can create branch order status events" ON public.order_status_events
  FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));
```
Impact: **re-introduces the P1 finding** — staff can forge status history, managers
can make unaudited price edits and fabricate waste events. Do NOT do this to fix a
routine write bug; fix that forward via the RPC instead.

### Reverse 202606301000 / 202607011300 (grant migrations)
These only add/normalize grants the app requires. Reversal is not recommended and
would break app reads. If truly needed, restore from the pre-change backup.

## Full restore from backup (catastrophic only)

If the database is corrupted or lost, restore the latest verified encrypted
backup into a fresh Supabase project — see `ptm-phase1-recovery.md`
("Restore-into-scratch drill"), pointing `SCRATCH_PSQL` at the new project's DB,
then re-point the app env at it. RPO ≤ last backup interval.

## After any rollback

1. Re-run `npx supabase migration list --linked` and record the resulting head.
2. Re-run the release gate: `RELEASE_GATE_MODE=release ... pnpm verify:release-gate`.
3. Update `PTM_REMEDIATION_PHASE_1_EVIDENCE.json` with the new state.
4. Do not leave production in a state where the release gate is red without a
   tracked follow-up.
