-- V12.1 Database Authority Seal
--
-- Objective: eliminate public mutation paths and make future function grants
-- fail closed by default. This is forward-only; historical migrations remain
-- immutable evidence.

-- 1. Default privilege hardening ---------------------------------------------
-- PostgreSQL grants EXECUTE on new functions to PUBLIC unless default privileges
-- are changed. Revoke that inheritance for future functions created by the
-- migration owner in public.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Supabase migrations normally run as postgres. Keep this explicit so future
-- migrations created by postgres also inherit the sealed default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Default ACL revocation is not sufficient on every Supabase/Postgres bootstrap:
-- functions can still inherit hard-wired PUBLIC EXECUTE. Enforce the invariant
-- with a DDL guard that revokes client EXECUTE from every newly created public
-- function. Future migrations must explicitly grant any intended client RPC.
CREATE OR REPLACE FUNCTION public.v12_1_revoke_client_execute_on_new_function()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cmd record;
BEGIN
  FOR v_cmd IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF v_cmd.schema_name = 'public' AND v_cmd.object_type = 'function' THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        v_cmd.object_identity
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.v12_1_revoke_client_execute_on_new_function()
  FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS v12_1_revoke_client_execute_on_new_function;
CREATE EVENT TRIGGER v12_1_revoke_client_execute_on_new_function
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION')
  EXECUTE FUNCTION public.v12_1_revoke_client_execute_on_new_function();

-- 2. Remove obsolete public mutation overloads -------------------------------
-- These signatures are not used by the V11/V12 application boundary. Dropping
-- them removes historical grants and prevents PostgREST from resolving an older
-- public mutation path.
DROP FUNCTION IF EXISTS public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb
);
DROP FUNCTION IF EXISTS public.cancel_public_order(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_order_by_ref(text, text);
DROP FUNCTION IF EXISTS public.get_public_order(text);

-- 3. Seal active mutation RPC grants -----------------------------------------
-- Checkout writes are server-authoritative: the application calls this only via
-- the server-only service-role transport after shared Zod validation.
REVOKE ALL ON FUNCTION public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb, boolean
) TO service_role;

-- Rate-limit rows are operational state. Public routes may request rate limiting
-- only through server code; anon no longer mutates public_rate_limits directly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.public_rate_limits
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer)
  TO service_role;

-- Public order establishment/cancellation were sealed in V11.1. Repeat the
-- invariant here so V12.1 carries the complete authority contract.
REVOKE ALL ON FUNCTION public.establish_public_order_access(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.establish_public_order_access(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.cancel_public_order(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_public_order(uuid, text, integer)
  TO service_role;

-- 4. Replace generic user-emitted audit with server-authoritative emission ----
-- App code emits generic audit evidence through src/lib/server/audit.ts using
-- service-role transport. Authenticated users must not call emit_audit_log
-- directly over PostgREST. Business RPCs remain authoritative audit producers.
--
-- transition_order_status previously remained SECURITY INVOKER so it needed
-- authenticated EXECUTE on emit_audit_log. Recreate it as SECURITY DEFINER while
-- preserving explicit auth.uid(), branch, transition, and RLS-equivalent checks.
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id uuid,
  p_next_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_id uuid;
  v_actor uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF p_next_status NOT IN ('incoming', 'prepping', 'ready', 'collected', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown order status: %', p_next_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  v_allowed := CASE
    WHEN v_order.status = 'incoming' AND p_next_status IN ('prepping', 'cancelled') THEN true
    WHEN v_order.status = 'prepping' AND p_next_status IN ('ready', 'cancelled') THEN true
    WHEN v_order.status = 'ready' AND p_next_status IN ('collected', 'cancelled') THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid transition from % to %.', v_order.status, p_next_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET
    status = p_next_status,
    cancelled_by = CASE WHEN p_next_status = 'cancelled' THEN 'staff' ELSE cancelled_by END,
    cancellation_reason = CASE
      WHEN p_next_status = 'cancelled' THEN nullif(btrim(coalesce(p_note, '')), '')
      ELSE cancellation_reason
    END
  WHERE id = p_order_id;

  INSERT INTO public.order_status_events (branch_id, order_id, status, actor_id, note)
  VALUES (v_order.branch_id, p_order_id, p_next_status, v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_event_id;

  PERFORM public.emit_audit_log(
    'order_status_changed',
    'order',
    p_order_id,
    v_order.branch_id,
    jsonb_build_object('from', v_order.status, 'to', p_next_status, 'order_ref', v_order.order_ref)
  );

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_status(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  TO service_role;

-- 5. Self-verifying authority invariant --------------------------------------
DO $$
DECLARE
  v_signature text;
  v_reg regprocedure;
  v_role text;
  v_bad_table_grants int;
BEGIN
  -- New functions must not inherit PUBLIC/anon/authenticated EXECUTE.
  EXECUTE 'CREATE FUNCTION public.v12_1_default_privilege_probe()
    RETURNS integer
    LANGUAGE sql
    AS ''SELECT 1''';

  IF has_function_privilege('anon', 'public.v12_1_default_privilege_probe()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v12_1_default_privilege_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'V12.1 default privilege hardening failed: new functions are client-executable';
  END IF;

  EXECUTE 'DROP FUNCTION public.v12_1_default_privilege_probe()';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_event_trigger
    WHERE evtname = 'v12_1_revoke_client_execute_on_new_function'
      AND evtenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'V12.1 default privilege hardening failed: function DDL guard is not enabled';
  END IF;

  -- Obsolete public mutation functions must be gone.
  IF to_regprocedure('public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'V12.1 authority seal failed: legacy create_checkout_order overload remains';
  END IF;
  IF to_regprocedure('public.cancel_public_order(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V12.1 authority seal failed: legacy cancel_public_order overload remains';
  END IF;
  IF to_regprocedure('public.cancel_order_by_ref(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V12.1 authority seal failed: cancel_order_by_ref remains';
  END IF;
  IF to_regprocedure('public.get_public_order(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V12.1 authority seal failed: get_public_order remains';
  END IF;

  -- Forbidden client execution on mutation/audit authority RPCs.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb,boolean)',
    'public.check_rate_limit(text,text,integer,integer)',
    'public.establish_public_order_access(text,text)',
    'public.cancel_public_order(uuid,text,integer)',
    'public.emit_audit_log(text,text,uuid,uuid,jsonb,text)'
  ] LOOP
    v_reg := to_regprocedure(v_signature);
    IF v_reg IS NULL THEN
      RAISE EXCEPTION 'V12.1 authority seal failed: expected function missing: %', v_signature;
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_reg, 'EXECUTE') THEN
        RAISE EXCEPTION 'V12.1 authority seal failed: % can execute %', v_role, v_signature;
      END IF;
    END LOOP;

    IF NOT has_function_privilege('service_role', v_reg, 'EXECUTE') THEN
      RAISE EXCEPTION 'V12.1 authority seal failed: service_role cannot execute %', v_signature;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_bad_table_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('audit_logs', 'audit_events', 'public_rate_limits')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  IF v_bad_table_grants <> 0 THEN
    RAISE EXCEPTION 'V12.1 authority seal failed: forbidden client table mutation grants remain';
  END IF;
END $$;
