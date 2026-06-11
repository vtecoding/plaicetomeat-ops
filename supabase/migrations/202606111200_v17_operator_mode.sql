-- V17 Operator Mode — Phase 1: account flag + supporting tables.
--
-- This migration is additive and safe to run on a live database:
--   * profiles.operator_mode is the ONLY column read by app code in Phase 1
--     (login routing + middleware route-lock). It defaults false, so every
--     existing account is unaffected.
--   * The four supporting tables are created now so the schema is stable for
--     later phases, but Phase 1 does not read or write them from the client.
--
-- Authority model: consistent with the V12 RPC authority seal, all WRITES to
-- these tables will go through SECURITY DEFINER RPCs (added with the phase that
-- uses them) or the service client (server-only). RLS is therefore enabled with
-- NO client policies here: the tables are deny-by-default to anon/auth sessions,
-- and only the service role / SECURITY DEFINER functions can touch them. This is
-- intentional, not an oversight — it prevents any direct client table write.

-- 1) Operator account flag -----------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS operator_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.operator_mode IS
  'V17: when true, this (manager-rank) account is locked to /operator and cannot reach /admin. Authority rank is unchanged; this only selects the simple guided surface.';

-- 2) Branch-level Owner Away / summary settings --------------------------------

CREATE TABLE IF NOT EXISTS public.branch_operator_settings (
  branch_id     uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  owner_away    boolean NOT NULL DEFAULT false,
  away_since    timestamptz,
  summary_time  time NOT NULL DEFAULT '19:00',
  owner_contact text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.branch_operator_settings IS
  'V17: per-branch Owner Away Mode + daily-summary configuration. Owner-only writes (via RPC).';

ALTER TABLE public.branch_operator_settings ENABLE ROW LEVEL SECURITY;

-- 3) Resumable guided-workflow runs (operator UX state, NOT business state) -----

CREATE TABLE IF NOT EXISTS public.operator_workflow_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES public.profiles(id),
  workflow    text NOT NULL CHECK (workflow IN ('open', 'close', 'serve', 'delivery', 'waste', 'certificate')),
  status      text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  steps       jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_ref  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operator_workflow_runs IS
  'V17: durable resume state for a guided operator workflow. The business record lives in the domain tables; this only lets an interrupted run resume.';

CREATE INDEX IF NOT EXISTS operator_workflow_runs_branch_status_idx
  ON public.operator_workflow_runs (branch_id, status, updated_at DESC);

ALTER TABLE public.operator_workflow_runs ENABLE ROW LEVEL SECURITY;

-- 4) Owner alerts (durable inbox; complements transient dispatchAlert) ----------

CREATE TABLE IF NOT EXISTS public.owner_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  severity    text NOT NULL CHECK (severity IN ('warning', 'critical')),
  kind        text NOT NULL,
  summary     text NOT NULL,
  entity_ref  text,
  created_by  uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.owner_alerts IS
  'V17: durable owner alert inbox (fridge fail, cert expiry, delivery mismatch, shop not opened, ...). Surfaced on owner TODAY / While-you-were-away.';

CREATE INDEX IF NOT EXISTS owner_alerts_branch_open_idx
  ON public.owner_alerts (branch_id, created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.owner_alerts ENABLE ROW LEVEL SECURITY;

-- 5) Compliance documents needing owner review (cert capture / unclassified) ----

CREATE TABLE IF NOT EXISTS public.compliance_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  document_url text NOT NULL,
  doc_type     text,
  status       text NOT NULL DEFAULT 'needs_owner_review'
                 CHECK (status IN ('needs_owner_review', 'classified', 'linked')),
  uploaded_by  uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.compliance_documents IS
  'V17: documents an operator photographed (certs, invoices, delivery notes). Always stored, even if unclassified, and surfaced to the owner for review. Operator is never responsible for classification.';

CREATE INDEX IF NOT EXISTS compliance_documents_branch_review_idx
  ON public.compliance_documents (branch_id, created_at DESC)
  WHERE status = 'needs_owner_review';

ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
