-- Compliance Temperature Capture (post-V12.10 remediation).
--
-- Problem sealed: /counter/compliance ("Food safety" in the staff nav) rendered
-- HARDCODED demo temperature readings as "Recorded today" with inert capture
-- buttons. For a butcher, fridge/freezer temperature logs are legal food-safety
-- evidence; a screen that fabricates them is a launch hazard.
--
-- This migration makes temperature capture real and hardened, mirroring the V12.6
-- checklist-evidence pattern:
--   * the compliance_logs / compliance_readings tables already exist (init);
--   * writes now flow ONLY through SECURITY DEFINER RPCs that derive the actor from
--     auth.uid(), authorise the branch (is_branch_staff), validate inputs, and emit
--     audit evidence in-transaction;
--   * the forgeable direct-insert/update RLS policies are dropped and client write
--     privileges revoked (mirrors V11.2 audit-authenticity), so staff cannot bypass
--     the RPC to write arbitrary readings. SELECT policies are retained for reads.
--
-- Rollback: re-create the dropped INSERT/UPDATE policies (NOT recommended — reopens
-- forgeable temperature evidence). The RPCs are additive/idempotent.

-- 1. Record a temperature reading (get-or-create today's log) --------------------
CREATE OR REPLACE FUNCTION public.record_compliance_reading(
  p_branch_id uuid,
  p_reading_type text,
  p_chiller_temp_c numeric,
  p_freezer_temp_c numeric,
  p_display_temp_c numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_log_id uuid;
  v_reading_id uuid;
  -- Physical sanity bounds only (not a safety judgement): out-of-safe-range temps
  -- must still be recordable so a breach can be logged honestly. Typos are rejected.
  v_min CONSTANT numeric := -50;
  v_max CONSTANT numeric := 50;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_staff(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_reading_type NOT IN ('opening', 'midday', 'closing', 'ad_hoc') THEN
    RAISE EXCEPTION 'Unknown reading type.' USING ERRCODE = '22023';
  END IF;
  IF p_chiller_temp_c IS NULL OR p_freezer_temp_c IS NULL THEN
    RAISE EXCEPTION 'Chiller and freezer temperatures are required.' USING ERRCODE = '22023';
  END IF;
  IF p_chiller_temp_c < v_min OR p_chiller_temp_c > v_max
     OR p_freezer_temp_c < v_min OR p_freezer_temp_c > v_max
     OR (p_display_temp_c IS NOT NULL AND (p_display_temp_c < v_min OR p_display_temp_c > v_max)) THEN
    RAISE EXCEPTION 'Temperature reading is out of range.' USING ERRCODE = '22023';
  END IF;

  -- Get-or-create today's log for this branch. opened_by is set on creation only.
  INSERT INTO public.compliance_logs(branch_id, log_date, opened_by)
  VALUES (p_branch_id, current_date, v_actor)
  ON CONFLICT (branch_id, log_date) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_log_id;

  INSERT INTO public.compliance_readings(
    branch_id, compliance_log_id, reading_type,
    chiller_temp_c, freezer_temp_c, display_temp_c, recorded_by, recorded_at
  )
  VALUES (
    p_branch_id, v_log_id, p_reading_type,
    p_chiller_temp_c, p_freezer_temp_c, p_display_temp_c, v_actor, now()
  )
  RETURNING id INTO v_reading_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('compliance_reading_recorded', 'compliance_log', v_log_id, p_branch_id, v_actor,
    jsonb_build_object(
      'reading_type', p_reading_type,
      'chiller_temp_c', p_chiller_temp_c,
      'freezer_temp_c', p_freezer_temp_c,
      'display_temp_c', p_display_temp_c));

  RETURN v_reading_id;
END;
$$;

-- 2. Complete today's compliance log (validated server-side) ---------------------
CREATE OR REPLACE FUNCTION public.complete_compliance_log(
  p_branch_id uuid,
  p_cleaning_completed boolean,
  p_sanitisation_completed boolean,
  p_waste_checked boolean,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_log public.compliance_logs%ROWTYPE;
  v_opening_count integer := 0;
  v_closing_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_staff(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_log
  FROM public.compliance_logs
  WHERE branch_id = p_branch_id AND log_date = current_date
  FOR UPDATE;

  IF v_log.id IS NULL THEN
    RAISE EXCEPTION 'No compliance log to complete. Add a temperature reading first.' USING ERRCODE = 'P0002';
  END IF;
  IF v_log.status = 'completed' THEN
    RETURN v_log.id;
  END IF;

  SELECT
    count(*) FILTER (WHERE reading_type = 'opening'),
    count(*) FILTER (WHERE reading_type = 'closing')
  INTO v_opening_count, v_closing_count
  FROM public.compliance_readings
  WHERE compliance_log_id = v_log.id;

  IF v_opening_count = 0 OR v_closing_count = 0 THEN
    RAISE EXCEPTION 'Add an opening and a closing temperature reading before completing.' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_cleaning_completed AND p_sanitisation_completed AND p_waste_checked) THEN
    RAISE EXCEPTION 'Cleaning, sanitisation, and waste checks must all be completed.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.compliance_logs
  SET cleaning_completed = true,
      sanitisation_completed = true,
      waste_checked = true,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      status = 'completed',
      closed_by = v_actor
  WHERE id = v_log.id
  RETURNING * INTO v_log;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('compliance_log_completed', 'compliance_log', v_log.id, p_branch_id, v_actor,
    jsonb_build_object('log_date', v_log.log_date, 'opening_readings', v_opening_count, 'closing_readings', v_closing_count));

  RETURN v_log.id;
END;
$$;

-- 3. Close the forgeable direct-write hole (mirrors V11.2) -----------------------
-- Writes must flow through the SECURITY DEFINER RPCs above; staff can no longer
-- INSERT/UPDATE arbitrary compliance rows directly via PostgREST. SELECT is kept.
DROP POLICY IF EXISTS "staff can create branch compliance logs" ON public.compliance_logs;
DROP POLICY IF EXISTS "staff can update branch compliance logs" ON public.compliance_logs;
DROP POLICY IF EXISTS "staff can create branch compliance readings" ON public.compliance_readings;
DROP POLICY IF EXISTS "staff can update branch compliance readings" ON public.compliance_readings;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.compliance_logs FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.compliance_readings FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_compliance_reading(uuid, text, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_compliance_log(uuid, boolean, boolean, boolean, text) TO authenticated;

-- 4. Self-enforcing invariant: no residual direct-write hole ---------------------
DO $$
DECLARE
  v_bad_grant int;
  v_bad_policy int;
BEGIN
  SELECT count(*) INTO v_bad_grant
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('compliance_logs', 'compliance_readings')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad_grant > 0 THEN
    RAISE EXCEPTION 'compliance capture invariant violated: % residual write grant(s)', v_bad_grant;
  END IF;

  SELECT count(*) INTO v_bad_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('compliance_logs', 'compliance_readings')
    AND cmd IN ('INSERT', 'UPDATE', 'ALL');
  IF v_bad_policy > 0 THEN
    RAISE EXCEPTION 'compliance capture invariant violated: % residual insert/update policy', v_bad_policy;
  END IF;

  RAISE NOTICE 'compliance temperature capture: direct-write hole closed; RPC-only writes.';
END;
$$;
