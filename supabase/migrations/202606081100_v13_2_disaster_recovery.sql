-- V13.2 - Disaster Recovery Certification & Recovery Proof.
--
-- This migration adds a hardened evidence chain for backup/restore drills. It does
-- not implement backups itself; it records proof that a backup was created,
-- restored, parity-checked, integrity-checked, and certified.
--
-- Provenance is a first-class invariant:
--   * LOCAL can only be TEST.
--   * REAL can only be PRODUCTION.
--   * PRODUCTION can only be REAL.
-- A local framework check can never masquerade as a production recovery drill.
--
-- Writes flow only through SECURITY DEFINER RPCs that derive the actor from
-- auth.uid(), authorise through is_branch_manager, emit audit rows, and fail
-- closed on inconsistent parity/integrity/verdict claims.

CREATE TABLE IF NOT EXISTS public.recovery_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('LOCAL', 'STAGING', 'PRODUCTION')),
  drill_type text NOT NULL CHECK (drill_type IN ('TEST', 'REAL')),
  backup_created_at timestamptz NOT NULL,
  restore_completed_at timestamptz,
  source_row_count bigint NOT NULL CHECK (source_row_count >= 0),
  restored_row_count bigint CHECK (restored_row_count >= 0),
  parity_status text NOT NULL DEFAULT 'PENDING' CHECK (parity_status IN ('PENDING', 'PARITY_PASSED', 'PARITY_FAILED')),
  integrity_status text NOT NULL DEFAULT 'PENDING' CHECK (integrity_status IN ('PENDING', 'INTEGRITY_PASSED', 'INTEGRITY_FAILED')),
  overall_verdict text NOT NULL DEFAULT 'PENDING' CHECK (overall_verdict IN ('PENDING', 'RECOVERY_CERTIFIED', 'RECOVERY_FAILED')),
  executed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_drills_provenance CHECK (
    (environment = 'LOCAL' AND drill_type = 'TEST')
    OR (environment = 'STAGING' AND drill_type = 'TEST')
    OR (environment = 'PRODUCTION' AND drill_type = 'REAL')
  ),
  CONSTRAINT recovery_drills_certification_truth CHECK (
    overall_verdict <> 'RECOVERY_CERTIFIED'
    OR (
      parity_status = 'PARITY_PASSED'
      AND integrity_status = 'INTEGRITY_PASSED'
      AND restored_row_count = source_row_count
    )
  )
);

CREATE TABLE IF NOT EXISTS public.recovery_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_drill_id uuid NOT NULL REFERENCES public.recovery_drills(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('BACKUP', 'RESTORE_LOG', 'PARITY', 'INTEGRITY', 'CERTIFICATION')),
  artifact_name text NOT NULL,
  artifact_checksum text NOT NULL,
  artifact_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_drills_branch_created
ON public.recovery_drills(branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recovery_artifacts_drill
ON public.recovery_artifacts(recovery_drill_id, artifact_type);

ALTER TABLE public.recovery_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read recovery drills" ON public.recovery_drills;
CREATE POLICY "managers read recovery drills" ON public.recovery_drills
FOR SELECT USING (public.is_branch_manager(branch_id));

DROP POLICY IF EXISTS "managers read recovery artifacts" ON public.recovery_artifacts;
CREATE POLICY "managers read recovery artifacts" ON public.recovery_artifacts
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.recovery_drills rd
    WHERE rd.id = recovery_drill_id
      AND public.is_branch_manager(rd.branch_id)
  )
);

CREATE OR REPLACE FUNCTION public.record_recovery_drill(
  p_branch_id uuid,
  p_environment text,
  p_drill_type text,
  p_backup_created_at timestamptz,
  p_source_row_count bigint,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_environment NOT IN ('LOCAL', 'STAGING', 'PRODUCTION') THEN
    RAISE EXCEPTION 'Unknown recovery environment.' USING ERRCODE = '22023';
  END IF;
  IF p_drill_type NOT IN ('TEST', 'REAL') THEN
    RAISE EXCEPTION 'Unknown recovery drill type.' USING ERRCODE = '22023';
  END IF;
  IF p_environment = 'LOCAL' AND p_drill_type <> 'TEST' THEN
    RAISE EXCEPTION 'LOCAL recovery drills are TEST data only.' USING ERRCODE = '22023';
  END IF;
  IF p_drill_type = 'REAL' AND p_environment <> 'PRODUCTION' THEN
    RAISE EXCEPTION 'REAL recovery drills must be PRODUCTION.' USING ERRCODE = '22023';
  END IF;
  IF p_environment = 'PRODUCTION' AND p_drill_type <> 'REAL' THEN
    RAISE EXCEPTION 'PRODUCTION recovery drills must be REAL.' USING ERRCODE = '22023';
  END IF;
  IF p_backup_created_at IS NULL THEN
    RAISE EXCEPTION 'Backup creation timestamp is required.' USING ERRCODE = '22023';
  END IF;
  IF p_source_row_count IS NULL OR p_source_row_count < 0 THEN
    RAISE EXCEPTION 'Source row count must be non-negative.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.recovery_drills(
    branch_id, environment, drill_type, backup_created_at, source_row_count, executed_by, notes
  )
  VALUES (
    p_branch_id, p_environment, p_drill_type, p_backup_created_at, p_source_row_count,
    v_actor, nullif(btrim(coalesce(p_notes, '')), '')
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('recovery_drill_started', 'recovery_drill', v_id, p_branch_id, v_actor,
    jsonb_build_object(
      'environment', p_environment,
      'drill_type', p_drill_type,
      'source_row_count', p_source_row_count
    ));

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_recovery_artifact(
  p_recovery_drill_id uuid,
  p_artifact_type text,
  p_artifact_name text,
  p_artifact_checksum text,
  p_artifact_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_drill public.recovery_drills%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_drill
  FROM public.recovery_drills
  WHERE id = p_recovery_drill_id
  FOR UPDATE;

  IF v_drill.id IS NULL THEN
    RAISE EXCEPTION 'Recovery drill not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_drill.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_drill.overall_verdict <> 'PENDING' THEN
    RAISE EXCEPTION 'Recovery drill is already completed.' USING ERRCODE = '22023';
  END IF;
  IF p_artifact_type NOT IN ('BACKUP', 'RESTORE_LOG', 'PARITY', 'INTEGRITY', 'CERTIFICATION') THEN
    RAISE EXCEPTION 'Unknown recovery artifact type.' USING ERRCODE = '22023';
  END IF;
  IF p_artifact_name IS NULL OR btrim(p_artifact_name) = '' THEN
    RAISE EXCEPTION 'Artifact name is required.' USING ERRCODE = '22023';
  END IF;
  IF p_artifact_checksum IS NULL OR btrim(p_artifact_checksum) = '' THEN
    RAISE EXCEPTION 'Artifact checksum is required.' USING ERRCODE = '22023';
  END IF;
  IF p_artifact_type = 'BACKUP'
     AND coalesce((p_artifact_metadata->>'backup_size_bytes')::bigint, 0) <= 0 THEN
    RAISE EXCEPTION 'Backup artifact must include backup_size_bytes.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.recovery_artifacts(
    recovery_drill_id, artifact_type, artifact_name, artifact_checksum, artifact_metadata
  )
  VALUES (
    p_recovery_drill_id,
    p_artifact_type,
    btrim(p_artifact_name),
    btrim(p_artifact_checksum),
    coalesce(p_artifact_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('recovery_artifact_recorded', 'recovery_artifact', v_id, v_drill.branch_id, v_actor,
    jsonb_build_object(
      'recovery_drill_id', p_recovery_drill_id,
      'artifact_type', p_artifact_type,
      'artifact_name', btrim(p_artifact_name)
    ));

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_recovery_drill(
  p_recovery_drill_id uuid,
  p_restore_completed_at timestamptz,
  p_restored_row_count bigint,
  p_parity_status text,
  p_integrity_status text,
  p_overall_verdict text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_drill public.recovery_drills%ROWTYPE;
  v_backup_artifacts integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_drill
  FROM public.recovery_drills
  WHERE id = p_recovery_drill_id
  FOR UPDATE;

  IF v_drill.id IS NULL THEN
    RAISE EXCEPTION 'Recovery drill not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_drill.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_drill.overall_verdict <> 'PENDING' THEN
    RAISE EXCEPTION 'Recovery drill is already completed.' USING ERRCODE = '22023';
  END IF;
  IF p_restore_completed_at IS NULL THEN
    RAISE EXCEPTION 'Restore completion timestamp is required.' USING ERRCODE = '22023';
  END IF;
  IF p_restored_row_count IS NULL OR p_restored_row_count < 0 THEN
    RAISE EXCEPTION 'Restored row count must be non-negative.' USING ERRCODE = '22023';
  END IF;
  IF p_parity_status NOT IN ('PARITY_PASSED', 'PARITY_FAILED') THEN
    RAISE EXCEPTION 'Unknown parity status.' USING ERRCODE = '22023';
  END IF;
  IF p_integrity_status NOT IN ('INTEGRITY_PASSED', 'INTEGRITY_FAILED') THEN
    RAISE EXCEPTION 'Unknown integrity status.' USING ERRCODE = '22023';
  END IF;
  IF p_overall_verdict NOT IN ('RECOVERY_CERTIFIED', 'RECOVERY_FAILED') THEN
    RAISE EXCEPTION 'Unknown recovery verdict.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_backup_artifacts
  FROM public.recovery_artifacts
  WHERE recovery_drill_id = p_recovery_drill_id
    AND artifact_type = 'BACKUP';
  IF v_backup_artifacts = 0 THEN
    RAISE EXCEPTION 'Cannot complete recovery drill without backup evidence.' USING ERRCODE = '22023';
  END IF;

  IF p_parity_status = 'PARITY_PASSED' AND p_restored_row_count <> v_drill.source_row_count THEN
    RAISE EXCEPTION 'Parity cannot pass with a row-count mismatch.' USING ERRCODE = '22023';
  END IF;
  IF p_overall_verdict = 'RECOVERY_CERTIFIED'
     AND (p_parity_status <> 'PARITY_PASSED'
          OR p_integrity_status <> 'INTEGRITY_PASSED'
          OR p_restored_row_count <> v_drill.source_row_count) THEN
    RAISE EXCEPTION 'Recovery cannot be certified unless parity and integrity pass.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.recovery_drills
  SET restore_completed_at = p_restore_completed_at,
      restored_row_count = p_restored_row_count,
      parity_status = p_parity_status,
      integrity_status = p_integrity_status,
      overall_verdict = p_overall_verdict,
      notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
      updated_at = now()
  WHERE id = p_recovery_drill_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('recovery_drill_completed', 'recovery_drill', p_recovery_drill_id, v_drill.branch_id, v_actor,
    jsonb_build_object(
      'environment', v_drill.environment,
      'drill_type', v_drill.drill_type,
      'source_row_count', v_drill.source_row_count,
      'restored_row_count', p_restored_row_count,
      'parity_status', p_parity_status,
      'integrity_status', p_integrity_status,
      'overall_verdict', p_overall_verdict
    ));

  RETURN p_recovery_drill_id;
END;
$$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.recovery_drills FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.recovery_artifacts FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_recovery_drill(uuid, text, text, timestamptz, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_recovery_artifact(uuid, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_recovery_drill(uuid, timestamptz, bigint, text, text, text, text) TO authenticated;

DO $$
DECLARE
  v_bad_grant int;
  v_bad_policy int;
BEGIN
  SELECT count(*) INTO v_bad_grant
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('recovery_drills', 'recovery_artifacts')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad_grant > 0 THEN
    RAISE EXCEPTION 'recovery invariant violated: % residual write grant(s)', v_bad_grant;
  END IF;

  SELECT count(*) INTO v_bad_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('recovery_drills', 'recovery_artifacts')
    AND cmd IN ('INSERT', 'UPDATE', 'ALL');
  IF v_bad_policy > 0 THEN
    RAISE EXCEPTION 'recovery invariant violated: % residual insert/update policy', v_bad_policy;
  END IF;

  RAISE NOTICE 'disaster recovery evidence: provenance sealed; RPC-only writes.';
END;
$$;
