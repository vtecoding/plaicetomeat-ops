-- V18 B1 Phase 3.5: an accepted Web Push dispatch is terminal delivery truth,
-- but the controlled duplicate-suppression certification must be able to
-- resend that same logical dispatch identity. Re-arm the existing row; never
-- mint a second alert or dispatch id.

CREATE OR REPLACE FUNCTION public.replay_alert_dispatch_v18(
  p_dispatch_id uuid
)
RETURNS public.alert_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.alert_dispatches%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.alert_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Dispatch not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status NOT IN ('accepted', 'dead_letter', 'skipped', 'cancelled') THEN
    RAISE EXCEPTION 'Only terminal dispatches can be replayed.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.alert_dispatches
  SET status = 'pending',
      attempt_budget = attempt_count + 6,
      next_attempt_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'owner_alert_lifecycle_changed', 'alert_dispatch', v_row.id, v_row.branch_id, NULL,
    jsonb_build_object('transition', 'replayed', 'rule', 'manual_replay', 'attempt_budget', v_row.attempt_budget)
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.replay_alert_dispatch_v18(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_alert_dispatch_v18(uuid) TO service_role;
