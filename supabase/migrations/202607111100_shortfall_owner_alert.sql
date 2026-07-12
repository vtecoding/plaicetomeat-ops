-- PTM-OBS-004 — oversell shortfall must actively reach the owner.
--
-- deplete_order_inventory records an oversell as a visible shortfall row
-- (order_inventory_depletions.status = 'completed_with_shortfall', shortfall_kg > 0)
-- and an inventory_depletion_shortfall audit log — but raised NO owner_alert, so
-- goods could leave the shop with the ledger short and the owner would only notice
-- if they happened to open the reconciliation view. That is a silent operational
-- failure from the owner's perspective.
--
-- This raises a 'warning' owner_alert whenever a depletion completes with a
-- shortfall. It surfaces through the existing unresolved-owner_alerts reader
-- (Owner Away summary), so the owner is actively told. A shortfall is stock-danger,
-- not low-urgency bookkeeping, so it is deliberately NOT folded into the batched
-- reconcile tray (which filters to RECONCILE_KIND_LIST) — it stays an individual item.
--
-- Additive + expand-safe: one trigger + one SECURITY DEFINER function on
-- order_inventory_depletions. deplete_order_inventory is unchanged. Dedup-guarded so
-- re-entrancy cannot create duplicate unresolved alerts for the same order.

CREATE OR REPLACE FUNCTION public.raise_shortfall_owner_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed_with_shortfall' AND coalesce(NEW.shortfall_kg, 0) > 0 THEN
    INSERT INTO public.owner_alerts(branch_id, severity, kind, summary, entity_ref, created_by)
    SELECT
      NEW.branch_id,
      'warning',
      'inventory_shortfall',
      'Stock ran short on a collected order — ' ||
        to_char(NEW.shortfall_kg, 'FM999999990.###') || ' kg short. Check stock and reorder.',
      'order:' || NEW.order_id::text,
      NEW.created_by
    WHERE NOT EXISTS (
      SELECT 1 FROM public.owner_alerts oa
      WHERE oa.branch_id = NEW.branch_id
        AND oa.kind = 'inventory_shortfall'
        AND oa.entity_ref = 'order:' || NEW.order_id::text
        AND oa.resolved_at IS NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_depletion_shortfall_alert ON public.order_inventory_depletions;
CREATE TRIGGER order_depletion_shortfall_alert
AFTER INSERT ON public.order_inventory_depletions
FOR EACH ROW EXECUTE FUNCTION public.raise_shortfall_owner_alert();
