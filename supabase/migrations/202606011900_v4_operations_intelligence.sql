-- V4 operations intelligence and release governance.
-- Adds permanent release records, post-deploy verification, migration health,
-- and cost-aware operational reporting surfaces.

CREATE TABLE IF NOT EXISTS public.release_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  commit_sha text NOT NULL,
  deployed_at timestamptz NOT NULL DEFAULT now(),
  migration_applied text,
  deployer text,
  release_notes text,
  gate_results jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_release_deployments_deployed_at
ON public.release_deployments(deployed_at DESC);

CREATE TABLE IF NOT EXISTS public.release_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.release_deployments(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'passed', 'failed')) DEFAULT 'pending',
  verifier uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verifier_name text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(release_id)
);

CREATE TRIGGER release_verifications_set_updated_at
BEFORE UPDATE ON public.release_verifications
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.release_verification_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES public.release_verifications(id) ON DELETE CASCADE,
  label text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'passed', 'failed')) DEFAULT 'pending',
  checked_at timestamptz,
  checked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(verification_id, label)
);

CREATE TRIGGER release_verification_items_set_updated_at
BEFORE UPDATE ON public.release_verification_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.release_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.release_deployments(id) ON DELETE CASCADE,
  release_version text NOT NULL,
  commit_sha text NOT NULL,
  migration text,
  hosted_smoke_result text NOT NULL CHECK (hosted_smoke_result IN ('pending', 'passed', 'failed')),
  release_report_result text NOT NULL CHECK (release_report_result IN ('pending', 'passed', 'failed')),
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(release_id)
);

CREATE OR REPLACE FUNCTION public.prevent_release_certification_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'release certifications are immutable';
END;
$$;

DROP TRIGGER IF EXISTS release_certifications_append_only ON public.release_certifications;
CREATE TRIGGER release_certifications_append_only
BEFORE UPDATE OR DELETE ON public.release_certifications
FOR EACH ROW EXECUTE FUNCTION public.prevent_release_certification_mutation();

CREATE TABLE IF NOT EXISTS public.expected_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.expected_migrations(version, name)
VALUES
  ('202605290001', 'init'),
  ('202605300001', 'v2_phase_a_backbone'),
  ('202605300002', 'v2_phase_b_ops'),
  ('202605300003', 'v2_phase_c_admin_products'),
  ('202605300004', 'v2_phase_d_admin_ops'),
  ('202605310001', 'v2_phase_e_sms_test_mode'),
  ('202605310002', 'v2_phase_e_customer_cancel'),
  ('202605310003', 'v2_1_compliance_inventory'),
  ('202606011430', 'v3_operational_system'),
  ('202606011900', 'v4_operations_intelligence')
ON CONFLICT (version) DO UPDATE SET name = excluded.name, required = true;

CREATE OR REPLACE FUNCTION public.get_applied_migration_versions()
RETURNS TABLE(version text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, supabase_migrations
AS $$
  SELECT sm.version::text
  FROM supabase_migrations.schema_migrations sm
  ORDER BY sm.version::text;
$$;

CREATE OR REPLACE FUNCTION public.get_migration_health()
RETURNS TABLE(expected_version text, migration_name text, applied boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, supabase_migrations
AS $$
  SELECT
    e.version AS expected_version,
    e.name AS migration_name,
    EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations sm
      WHERE sm.version::text = e.version
    ) AS applied
  FROM public.expected_migrations e
  WHERE e.required = true
  ORDER BY e.version;
$$;

CREATE OR REPLACE FUNCTION public.ensure_release_verification_items(p_verification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.release_verification_items(verification_id, label, sort_order)
  VALUES
    (p_verification_id, 'Admin login', 10),
    (p_verification_id, 'Shop ordering', 20),
    (p_verification_id, 'Counter updates', 30),
    (p_verification_id, 'Inventory creation', 40),
    (p_verification_id, 'Waste recording', 50),
    (p_verification_id, 'Supplier certificate', 60),
    (p_verification_id, 'Audit log creation', 70)
  ON CONFLICT (verification_id, label) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_release_deployment(
  p_version text,
  p_commit_sha text,
  p_migration_applied text,
  p_gate_results jsonb,
  p_deployer text,
  p_release_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_release_id uuid;
  v_verification_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF public.current_profile_role() NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.release_deployments(
    version, commit_sha, migration_applied, gate_results, deployer, release_notes
  )
  VALUES (
    btrim(p_version), btrim(p_commit_sha), nullif(btrim(coalesce(p_migration_applied, '')), ''),
    coalesce(p_gate_results, '{}'), nullif(btrim(coalesce(p_deployer, '')), ''),
    nullif(btrim(coalesce(p_release_notes, '')), '')
  )
  RETURNING id INTO v_release_id;

  INSERT INTO public.release_verifications(release_id)
  VALUES (v_release_id)
  RETURNING id INTO v_verification_id;

  PERFORM public.ensure_release_verification_items(v_verification_id);

  INSERT INTO public.audit_logs(event_type, target_type, target_id, actor_id, metadata)
  VALUES (
    'release_deployed', 'release_deployment', v_release_id, v_actor,
    jsonb_build_object('version', p_version, 'commit_sha', p_commit_sha)
  );

  RETURN v_release_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_release_verification_item(
  p_item_id uuid,
  p_status text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_verification_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF public.current_profile_role() NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised.' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'passed', 'failed') THEN
    RAISE EXCEPTION 'Invalid verification status.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.release_verification_items
  SET status = p_status,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      checked_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END,
      checked_by = CASE WHEN p_status = 'pending' THEN NULL ELSE v_actor END
  WHERE id = p_item_id
  RETURNING verification_id INTO v_verification_id;

  UPDATE public.release_verifications rv
  SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status = 'failed'
        ) THEN 'failed'
        WHEN EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status <> 'passed'
        ) THEN 'pending'
        ELSE 'passed'
      END,
      verifier = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status <> 'passed'
        ) THEN v_actor ELSE verifier
      END,
      verified_at = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status <> 'passed'
        ) THEN now() ELSE verified_at
      END
  WHERE rv.id = v_verification_id;

  RETURN p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.certify_release(
  p_release_id uuid,
  p_hosted_smoke_result text,
  p_release_report_result text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_release public.release_deployments%ROWTYPE;
  v_verification public.release_verifications%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_certification_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF public.current_profile_role() NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised.' USING ERRCODE = '42501';
  END IF;

  IF p_hosted_smoke_result NOT IN ('pending', 'passed', 'failed') OR p_release_report_result NOT IN ('pending', 'passed', 'failed') THEN
    RAISE EXCEPTION 'Invalid certification result.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_release FROM public.release_deployments WHERE id = p_release_id;
  SELECT * INTO v_verification FROM public.release_verifications WHERE release_id = p_release_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_actor;

  IF v_release.id IS NULL THEN
    RAISE EXCEPTION 'Release not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_verification.status <> 'passed' THEN
    RAISE EXCEPTION 'Post release verification must pass before certification.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.release_certifications(
    release_id, release_version, commit_sha, migration, hosted_smoke_result,
    release_report_result, verified_by, verified_at
  )
  VALUES (
    v_release.id, v_release.version, v_release.commit_sha, v_release.migration_applied,
    p_hosted_smoke_result, p_release_report_result,
    coalesce(v_profile.full_name, v_profile.email), now()
  )
  RETURNING id INTO v_certification_id;

  RETURN v_certification_id;
END;
$$;

ALTER TABLE public.release_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_verification_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expected_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers can read release deployments" ON public.release_deployments;
CREATE POLICY "managers can read release deployments" ON public.release_deployments
FOR SELECT USING (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can create release deployments" ON public.release_deployments;
CREATE POLICY "managers can create release deployments" ON public.release_deployments
FOR INSERT WITH CHECK (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can read release verifications" ON public.release_verifications;
CREATE POLICY "managers can read release verifications" ON public.release_verifications
FOR SELECT USING (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can update release verifications" ON public.release_verifications;
CREATE POLICY "managers can update release verifications" ON public.release_verifications
FOR UPDATE USING (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can read release verification items" ON public.release_verification_items;
CREATE POLICY "managers can read release verification items" ON public.release_verification_items
FOR SELECT USING (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can update release verification items" ON public.release_verification_items;
CREATE POLICY "managers can update release verification items" ON public.release_verification_items
FOR UPDATE USING (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can read release certifications" ON public.release_certifications;
CREATE POLICY "managers can read release certifications" ON public.release_certifications
FOR SELECT USING (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can create release certifications" ON public.release_certifications;
CREATE POLICY "managers can create release certifications" ON public.release_certifications
FOR INSERT WITH CHECK (public.current_profile_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "managers can read expected migrations" ON public.expected_migrations;
CREATE POLICY "managers can read expected migrations" ON public.expected_migrations
FOR SELECT USING (public.current_profile_role() IN ('manager', 'owner'));

GRANT EXECUTE ON FUNCTION public.get_applied_migration_versions() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_migration_health() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.create_release_deployment(text, text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_release_verification_item(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.certify_release(uuid, text, text) TO authenticated;
