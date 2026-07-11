-- Backup freshness ledger (supports the truthful /api/health backup-age signal).
--
-- The health endpoint must go DEGRADED when the latest verified backup is stale
-- (PTM-DR-001 / PTM-OBS-012). To report that truthfully the app needs a durable,
-- non-secret record of when a backup last succeeded. This adds an append-only
-- ledger that the production-backup pipeline stamps on success, plus a
-- SECURITY DEFINER reader that exposes ONLY safe aggregates (timestamp + age +
-- boolean freshness) to the anon health probe — never checksums or scope detail.
--
-- Expand-safe: new table + two functions only. No change to existing objects,
-- no locks on hot tables. Fail-closed by construction: with zero rows,
-- get_backup_freshness() reports no successful backup, so health degrades.

CREATE TABLE IF NOT EXISTS public.ops_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failure')),
  backup_mode text,
  row_count_total integer,
  migration_head text,
  encrypted_checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_backup_runs_success_idx
  ON public.ops_backup_runs (created_at DESC)
  WHERE status = 'success';

ALTER TABLE public.ops_backup_runs ENABLE ROW LEVEL SECURITY;
-- No permissive policy: only BYPASSRLS (service_role) and SECURITY DEFINER paths
-- may see or write rows. Strip the default anon/authenticated SELECT grant that
-- 202607011300 hands to new tables — the health read goes through the DEFINER
-- reader below, never a direct table select.
REVOKE ALL ON TABLE public.ops_backup_runs FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.ops_backup_runs TO service_role;

-- Append-only: block UPDATE/DELETE on the ledger even for privileged callers.
CREATE OR REPLACE FUNCTION public.prevent_ops_backup_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ops_backup_runs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS ops_backup_runs_append_only ON public.ops_backup_runs;
CREATE TRIGGER ops_backup_runs_append_only
BEFORE UPDATE OR DELETE ON public.ops_backup_runs
FOR EACH ROW EXECUTE FUNCTION public.prevent_ops_backup_run_mutation();

-- Writer: service-role command path only (the backup pipeline). SECURITY DEFINER
-- so it can insert under the append-only trigger; guarded to service_role.
CREATE OR REPLACE FUNCTION public.record_backup_run(
  p_environment text,
  p_status text,
  p_backup_mode text,
  p_row_count_total integer,
  p_migration_head text,
  p_encrypted_checksum text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_backup_run is restricted to the service role';
  END IF;
  INSERT INTO public.ops_backup_runs(
    environment, status, backup_mode, row_count_total, migration_head, encrypted_checksum
  )
  VALUES (
    p_environment, p_status, p_backup_mode, p_row_count_total, p_migration_head, p_encrypted_checksum
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_backup_run(text, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_backup_run(text, text, text, integer, text, text) TO service_role;

-- Reader: safe aggregates for the health probe. Returns the latest SUCCESSFUL
-- backup timestamp and its age, plus a freshness boolean against a threshold.
-- Exposes no checksum or scope detail. Granted to anon so /api/health (public
-- client) can read it, like get_migration_health.
CREATE OR REPLACE FUNCTION public.get_backup_freshness(p_max_age_hours integer DEFAULT 48)
RETURNS TABLE(
  last_success_at timestamptz,
  age_seconds bigint,
  is_fresh boolean,
  has_success boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    latest.created_at AS last_success_at,
    CASE WHEN latest.created_at IS NULL THEN NULL
         ELSE floor(extract(epoch FROM (now() - latest.created_at)))::bigint END AS age_seconds,
    CASE WHEN latest.created_at IS NULL THEN false
         ELSE now() - latest.created_at <= make_interval(hours => p_max_age_hours) END AS is_fresh,
    latest.created_at IS NOT NULL AS has_success
  FROM (
    SELECT max(created_at) AS created_at
    FROM public.ops_backup_runs
    WHERE status = 'success'
      AND environment = 'PRODUCTION'
  ) latest;
$$;

REVOKE ALL ON FUNCTION public.get_backup_freshness(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_backup_freshness(integer) TO anon, authenticated, service_role;
