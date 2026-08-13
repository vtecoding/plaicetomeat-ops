-- P0 production seal: collection/tender truth, refund/inventory truth and
-- application/schema compatibility are database-enforced boundaries.

-- 1. A collected order must have a sale tender in the same transaction.
--
-- This is a deferred constraint because collect_order_with_tender deliberately
-- performs the status transition (and therefore inventory depletion) before it
-- inserts payment_events. PostgreSQL evaluates this at commit, after every write
-- in the RPC has completed. A bare transition_order_status(..., 'collected')
-- therefore rolls back, while the canonical tender RPC remains one transaction.
CREATE OR REPLACE FUNCTION public.enforce_collected_order_has_sale_tender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
BEGIN
  IF NEW.status <> 'collected'
     OR (TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'collected') THEN
    RETURN NULL;
  END IF;

  -- A later update in this transaction may have moved the order away again.
  SELECT status INTO v_current_status FROM public.orders WHERE id = NEW.id;
  IF v_current_status <> 'collected' THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_events pe
    WHERE pe.order_id = NEW.id
      AND pe.direction = 'sale'
  ) THEN
    RAISE EXCEPTION 'Order collection requires a tender recorded in the same transaction.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_collected_order_has_sale_tender()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS orders_collected_requires_sale_tender ON public.orders;
CREATE CONSTRAINT TRIGGER orders_collected_requires_sale_tender
AFTER INSERT OR UPDATE ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_collected_order_has_sale_tender();

-- 2. The V14 whole-order reversal predates refund_order_v18. Leaving it callable
-- lets stock move without a refund operation, compensating payment event or line
-- disposition. Preserve the historical function only for forensic readability;
-- no application role may execute it.
REVOKE ALL ON FUNCTION public.admin_reverse_order_inventory(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.admin_reverse_order_inventory(uuid, text) IS
  'Legacy forensic function. Application execution revoked by 202608130900; use refund_order_v18 or an explicit audited correction boundary.';

-- 3. Expand the application/schema contract with an explicit two-generation
-- overlap. Generation 18 is the currently serving V18 application; generation
-- 19 is this Phase-1 release. The legacy migration reader intentionally remains
-- executable during expand so generation 18 stays healthy until 19 is serving.
-- Retirement is a later forward migration, created only after that promotion.
CREATE TABLE public.application_schema_contract (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  db_generation integer NOT NULL CHECK (db_generation > 0),
  min_supported_app_generation integer NOT NULL CHECK (min_supported_app_generation > 0),
  max_supported_app_generation integer NOT NULL CHECK (max_supported_app_generation >= min_supported_app_generation),
  migration_head text NOT NULL CHECK (migration_head ~ '^[0-9]{12}$'),
  expanded_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.application_schema_contract(
  singleton,
  db_generation,
  min_supported_app_generation,
  max_supported_app_generation,
  migration_head
) VALUES (true, 19, 18, 19, '202608130900');

REVOKE ALL ON TABLE public.application_schema_contract
  FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.application_schema_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_schema_contract FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_application_schema_contract_v1()
RETURNS TABLE(
  db_generation integer,
  min_supported_app_generation integer,
  max_supported_app_generation integer,
  migration_head text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.db_generation,
    c.min_supported_app_generation,
    c.max_supported_app_generation,
    c.migration_head
  FROM public.application_schema_contract c
  WHERE c.singleton;
$$;

REVOKE ALL ON FUNCTION public.get_application_schema_contract_v1()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_application_schema_contract_v1()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_application_schema_versions_v1()
RETURNS TABLE(version text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, supabase_migrations
AS $$
  SELECT sm.version::text
  FROM supabase_migrations.schema_migrations sm
  ORDER BY sm.version::text;
$$;

REVOKE ALL ON FUNCTION public.get_application_schema_versions_v1()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_application_schema_versions_v1()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_application_schema_versions_v1() IS
  'Versioned migration-evidence reader. Migration count is evidence, not the application/schema compatibility protocol.';

COMMENT ON FUNCTION public.get_application_schema_contract_v1() IS
  'Application/schema compatibility contract. An app may serve only when its generation is within the inclusive supported range.';

COMMENT ON TABLE public.application_schema_contract IS
  'Singleton expand/contract compatibility boundary. Generation retirement requires a later forward migration after exact-artifact promotion.';
