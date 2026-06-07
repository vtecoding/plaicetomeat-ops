-- V13.1 — Butcher Economics Validation (capture layer).
--
-- V13's biggest business risk: the app may confidently show INCORRECT pricing. This
-- migration adds a hardened capture surface where a real butcher reviews the system's
-- per-cut pricing assumptions (yield, blended cost, suggested price, target margin) and
-- records a verdict — APPROVED or CHANGES REQUIRED — cut by cut, as tamper-evident
-- evidence. The output feeds docs/reports/butcher-signoff-report.md.
--
-- It mirrors the V12.6 checklist-evidence / compliance-capture pattern exactly:
--   * one row per branch × species × cut;
--   * writes flow ONLY through a SECURITY DEFINER RPC that derives the actor from
--     auth.uid(), authorises the branch via is_branch_manager, validates inputs,
--     computes price variance server-side, and emits audit evidence in-transaction;
--   * NO forgeable direct-write policy is ever created; client INSERT/UPDATE/DELETE
--     grants are revoked; only a manager SELECT policy exists for reads;
--   * a self-enforcing invariant DO block fails the migration if a write hole exists.
--
-- This is a *validation record*, never a pricing source: nothing here changes product
-- prices. It captures what a butcher thinks of the system's recommendation.
--
-- Rollback: DROP TABLE public.pricing_validations CASCADE; and drop the RPC. The table
-- is additive and unreferenced by any runtime pricing path.

-- 1. Capture table ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  species text NOT NULL CHECK (species IN ('lamb', 'goat', 'beef', 'chicken')),
  cut_id text NOT NULL,
  cut_name text NOT NULL,
  -- System recommendation snapshot (as shown to the butcher at review time).
  system_yield_pct numeric NOT NULL,
  system_cost_per_kg numeric NOT NULL,
  system_price_per_kg numeric NOT NULL,
  system_margin_pct numeric NOT NULL,
  -- Butcher's real-world figures (nullable until reviewed).
  butcher_yield_pct numeric,
  butcher_price_per_kg numeric,
  -- Price variance, computed server-side: (butcher - system) / system * 100.
  variance_pct numeric,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'changes_required')),
  notes text,
  butcher_name text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One validation row per cut, per species, per branch → upsert is deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_validations_branch_species_cut
ON public.pricing_validations(branch_id, species, cut_id);

CREATE INDEX IF NOT EXISTS idx_pricing_validations_branch
ON public.pricing_validations(branch_id);

-- 2. Row level security (reads only; all writes go through the RPC) ---------------
ALTER TABLE public.pricing_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read pricing validations" ON public.pricing_validations;
CREATE POLICY "managers read pricing validations" ON public.pricing_validations
FOR SELECT USING (public.is_branch_manager(branch_id));

-- 3. Hardened capture RPC --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_pricing_validation(
  p_branch_id uuid,
  p_species text,
  p_cut_id text,
  p_cut_name text,
  p_system_yield_pct numeric,
  p_system_cost_per_kg numeric,
  p_system_price_per_kg numeric,
  p_system_margin_pct numeric,
  p_butcher_yield_pct numeric,
  p_butcher_price_per_kg numeric,
  p_decision text,
  p_notes text DEFAULT NULL,
  p_butcher_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_variance numeric;
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_species NOT IN ('lamb', 'goat', 'beef', 'chicken') THEN
    RAISE EXCEPTION 'Unknown species.' USING ERRCODE = '22023';
  END IF;
  IF p_cut_id IS NULL OR btrim(p_cut_id) = '' OR p_cut_name IS NULL OR btrim(p_cut_name) = '' THEN
    RAISE EXCEPTION 'Cut is required.' USING ERRCODE = '22023';
  END IF;
  IF p_decision NOT IN ('pending', 'approved', 'changes_required') THEN
    RAISE EXCEPTION 'Unknown decision.' USING ERRCODE = '22023';
  END IF;
  -- A real verdict (not 'pending') must carry the butcher's own figures, otherwise
  -- the "sign-off" would be evidence of nothing.
  IF p_decision <> 'pending'
     AND (p_butcher_yield_pct IS NULL OR p_butcher_price_per_kg IS NULL) THEN
    RAISE EXCEPTION 'Enter the butcher yield and price before approving or requesting changes.' USING ERRCODE = '22023';
  END IF;
  IF (p_butcher_yield_pct IS NOT NULL AND (p_butcher_yield_pct < 0 OR p_butcher_yield_pct > 1))
     OR (p_butcher_price_per_kg IS NOT NULL AND p_butcher_price_per_kg < 0) THEN
    RAISE EXCEPTION 'Butcher figures are out of range.' USING ERRCODE = '22023';
  END IF;

  -- Variance is derived server-side; the client never supplies it.
  IF p_butcher_price_per_kg IS NOT NULL AND p_system_price_per_kg IS NOT NULL AND p_system_price_per_kg <> 0 THEN
    v_variance := round(((p_butcher_price_per_kg - p_system_price_per_kg) / p_system_price_per_kg) * 100, 1);
  ELSE
    v_variance := NULL;
  END IF;

  INSERT INTO public.pricing_validations(
    branch_id, species, cut_id, cut_name,
    system_yield_pct, system_cost_per_kg, system_price_per_kg, system_margin_pct,
    butcher_yield_pct, butcher_price_per_kg, variance_pct,
    decision, notes, butcher_name, reviewed_by, reviewed_at
  )
  VALUES (
    p_branch_id, p_species, p_cut_id, p_cut_name,
    p_system_yield_pct, p_system_cost_per_kg, p_system_price_per_kg, p_system_margin_pct,
    p_butcher_yield_pct, p_butcher_price_per_kg, v_variance,
    p_decision, nullif(btrim(coalesce(p_notes, '')), ''), nullif(btrim(coalesce(p_butcher_name, '')), ''),
    v_actor, now()
  )
  ON CONFLICT (branch_id, species, cut_id) DO UPDATE SET
    cut_name = excluded.cut_name,
    system_yield_pct = excluded.system_yield_pct,
    system_cost_per_kg = excluded.system_cost_per_kg,
    system_price_per_kg = excluded.system_price_per_kg,
    system_margin_pct = excluded.system_margin_pct,
    butcher_yield_pct = excluded.butcher_yield_pct,
    butcher_price_per_kg = excluded.butcher_price_per_kg,
    variance_pct = excluded.variance_pct,
    decision = excluded.decision,
    notes = excluded.notes,
    butcher_name = excluded.butcher_name,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('pricing_validation_recorded', 'pricing_validation', v_id, p_branch_id, v_actor,
    jsonb_build_object(
      'species', p_species,
      'cut_id', p_cut_id,
      'decision', p_decision,
      'variance_pct', v_variance));

  RETURN v_id;
END;
$$;

-- 4. Close the forgeable direct-write hole (mirrors V11.2 / compliance capture) ---
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pricing_validations FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pricing_validation(
  uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text
) TO authenticated;

-- 5. Self-enforcing invariant: no residual direct-write hole ---------------------
DO $$
DECLARE
  v_bad_grant int;
  v_bad_policy int;
BEGIN
  SELECT count(*) INTO v_bad_grant
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'pricing_validations'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad_grant > 0 THEN
    RAISE EXCEPTION 'pricing validation invariant violated: % residual write grant(s)', v_bad_grant;
  END IF;

  SELECT count(*) INTO v_bad_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'pricing_validations'
    AND cmd IN ('INSERT', 'UPDATE', 'ALL');
  IF v_bad_policy > 0 THEN
    RAISE EXCEPTION 'pricing validation invariant violated: % residual insert/update policy', v_bad_policy;
  END IF;

  RAISE NOTICE 'pricing validation capture: direct-write hole closed; RPC-only writes.';
END;
$$;
