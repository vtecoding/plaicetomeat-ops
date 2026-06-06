-- V11.2 — Audit Authenticity Boundary
--
-- Problem sealed: audit evidence was forgeable.
--   * audit_logs carried an INSERT policy ("authenticated can create audit logs")
--     letting any branch staff write arbitrary rows directly via PostgREST —
--     forged event_type / actor_id / target_id / metadata, and branch_id = NULL
--     bypassed the branch check entirely.
--   * audit_events carried an even weaker policy ("authenticated can create audit
--     events", WITH CHECK auth.uid() IS NOT NULL) letting ANY authenticated user
--     forge a row with arbitrary actor_email, actor_role ('owner'), ip_address,
--     user_agent. audit_events is the surface the admin UI actually displays.
--
-- Target invariant (V11.2 spec §B): audit logs are system-generated evidence only.
-- No client, public caller, staff or manager user may directly insert/update/delete
-- audit records. Writes flow ONLY through trusted SECURITY DEFINER paths that run
-- in the table-owner context (existing business RPCs, the mirror trigger, and the
-- new emit_audit_log helper). Records bind actor + branch + action, set created_at
-- server-side, and never carry secrets / tokens / public access ids.
--
-- Append-only is already enforced (audit_logs_append_only / audit_events_append_only
-- triggers from 202605300001 / 202606011430); this migration re-asserts them and
-- closes the direct-write hole.
--
-- Rollback/forward-fix: to roll back, re-create the dropped INSERT policies and
-- re-grant INSERT to authenticated (NOT recommended — reopens forgery). The
-- emit_audit_log helper and revokes are additive/idempotent.

-- 1. Remove the forgeable direct-insert policies --------------------------------
DROP POLICY IF EXISTS "authenticated can create audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "authenticated can create audit events" ON public.audit_events;

-- 2. Revoke all direct write privileges from client roles ------------------------
-- Defence in depth alongside RLS. SELECT is retained (existing read policies still
-- govern row visibility). SECURITY DEFINER functions run as the table owner and are
-- unaffected, so every legitimate audited flow keeps working.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs  FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_events FROM anon, authenticated, PUBLIC;

-- 3. Re-assert append-only enforcement (idempotent) -----------------------------
-- These triggers already exist; re-create them so this migration is the single
-- authority for the append-only invariant even if applied against an older base.
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

CREATE OR REPLACE FUNCTION public.prevent_audit_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON public.audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_events_mutation();

-- 4. Single trusted audit emit helper -------------------------------------------
-- The sanctioned forward path for any server-only ad-hoc audit emission. Existing
-- business RPCs keep their inline owner-context inserts (they already validate the
-- actor before writing); this helper is for new server paths and is fail-closed:
--   * actor is ALWAYS derived from auth.uid() for authenticated callers — a
--     caller-supplied actor is impossible (no such parameter);
--   * system emission (no JWT subject, i.e. service_role) REQUIRES an explicit
--     reason and records actor_id = NULL;
--   * a non-system caller may never claim system authority;
--   * branch scope is validated (caller must be staff of the audited branch);
--   * event_type is checked against an allowlist;
--   * metadata must be a bounded JSON object; secret-like keys are stripped;
--   * created_at is defaulted server-side (no parameter).
CREATE OR REPLACE FUNCTION public.emit_audit_log(
  p_event_type text,
  p_target_type text,
  p_target_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_system_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_system boolean := (auth.uid() IS NULL);
  v_actor uuid;
  v_metadata jsonb;
  v_redacted jsonb := '[]'::jsonb;
  v_key text;
  v_id uuid;
  -- Allowlist mirrors the event_type vocabulary emitted across the schema.
  v_allowed CONSTANT text[] := ARRAY[
    'order_created', 'order_status_changed', 'price_changed', 'cost_changed',
    'pricing_committed', 'product_changed', 'product_availability_changed',
    'branch_settings_updated', 'inventory_remaining_adjusted', 'stock_added',
    'stock_corrected', 'stock_count_recorded', 'stock_count_line_applied',
    'batch_received', 'carcass_intake_confirmed', 'waste_recorded',
    'pickup_window_created', 'pickup_window_updated', 'pickup_window_disabled',
    'shop_closure_created', 'shop_closure_removed', 'ops_session_started',
    'ops_session_completed', 'ops_step_recorded', 'release_deployed',
    'sms_attempt', 'sms_template_updated', 'supplier_created',
    'certificate_uploaded', 'certificate_verified', 'security_event'
  ];
  -- Secret-like metadata keys are stripped before persistence (case-insensitive).
  v_secret_pattern CONSTANT text :=
    '(secret|token|password|passwd|access_id|public_access|cookie|authoriz|bearer|jwt|session|api[_-]?key|private[_-]?key|credential)';
BEGIN
  IF p_event_type IS NULL OR NOT (p_event_type = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Unknown audit event type: %', coalesce(p_event_type, '(null)')
      USING ERRCODE = '22023';
  END IF;

  IF p_target_type IS NULL OR btrim(p_target_type) = '' THEN
    RAISE EXCEPTION 'audit target_type is required' USING ERRCODE = '22023';
  END IF;

  -- Actor + authority.
  IF v_is_system THEN
    IF p_system_reason IS NULL OR btrim(p_system_reason) = '' THEN
      RAISE EXCEPTION 'system audit emission requires an explicit reason'
        USING ERRCODE = '22023';
    END IF;
    v_actor := NULL;
  ELSE
    v_actor := v_uid;
    IF p_system_reason IS NOT NULL THEN
      RAISE EXCEPTION 'only system callers may set a system reason'
        USING ERRCODE = '42501';
    END IF;
    IF p_branch_id IS NOT NULL AND NOT public.is_branch_staff(p_branch_id) THEN
      RAISE EXCEPTION 'not authorised to write audit evidence for this branch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Metadata hygiene.
  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'audit metadata must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF length(v_metadata::text) > 8192 THEN
    RAISE EXCEPTION 'audit metadata exceeds the maximum allowed size'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_metadata) LOOP
    IF v_key ~* v_secret_pattern THEN
      v_metadata := v_metadata - v_key;
      v_redacted := v_redacted || to_jsonb(v_key);
    END IF;
  END LOOP;
  IF jsonb_array_length(v_redacted) > 0 THEN
    v_metadata := jsonb_set(v_metadata, ARRAY['_redacted_keys'], v_redacted);
  END IF;
  IF p_system_reason IS NOT NULL THEN
    v_metadata := jsonb_set(v_metadata, ARRAY['system_reason'], to_jsonb(btrim(p_system_reason)));
  END IF;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (p_event_type, p_target_type, p_target_id, p_branch_id, v_actor, v_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  TO authenticated, service_role;

-- 5. Route the one SECURITY INVOKER emitter through the trusted helper ----------
-- transition_order_status is the only audit-emitting function that runs as the
-- INVOKER (it relies on RLS for its order SELECT). Its inline audit_logs INSERT
-- previously depended on the now-removed "authenticated can create audit logs"
-- grant, so it would fail closed after this migration. Re-route its audit write
-- through emit_audit_log: the nested SECURITY DEFINER call performs the append-only
-- insert in owner context while still deriving the actor from auth.uid() (the same
-- staff/manager) and validating branch scope (already checked above). The audit row
-- is byte-for-byte equivalent to the prior inline insert. Body is otherwise the
-- 202605300002 definition, unchanged.
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id uuid,
  p_next_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
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

  -- RLS on orders restricts this SELECT to the caller's branch, so an order in
  -- another branch simply appears as "not found" -> no cross-branch mutation.
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

  -- Trusted audit path (was an inline INSERT INTO public.audit_logs).
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

GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text) TO authenticated;

-- 6. Self-enforcing invariant assertions ----------------------------------------
-- Fail the migration if the direct-write hole is ever reintroduced. Captured in
-- migration-output.txt as positive evidence of the closed boundary.
DO $$
DECLARE
  v_bad_grant int;
  v_bad_policy int;
BEGIN
  SELECT count(*) INTO v_bad_grant
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('audit_logs', 'audit_events')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad_grant > 0 THEN
    RAISE EXCEPTION 'V11.2 invariant violated: % residual write grant(s) on audit tables', v_bad_grant;
  END IF;

  SELECT count(*) INTO v_bad_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('audit_logs', 'audit_events')
    AND cmd IN ('INSERT', 'ALL');
  IF v_bad_policy > 0 THEN
    RAISE EXCEPTION 'V11.2 invariant violated: % residual insert/all policy on audit tables', v_bad_policy;
  END IF;

  RAISE NOTICE 'V11.2 audit authenticity: direct-write hole closed (0 write grants, 0 insert policies).';
END;
$$;
