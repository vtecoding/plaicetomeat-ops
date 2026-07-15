-- V18 B1 Phase 2 — Edge dispatcher scheduling and health.
--
-- No Phase 1 contract changes. This migration only adds:
--   1. a read-only health RPC for the dispatcher's readiness endpoint
--      (checking RPC presence without mutating outbox state);
--   2. idempotent helpers that (un)schedule the 30-second Supabase Cron job
--      which wakes the Edge Function dispatcher.
--
-- The cron command resolves the function URL and bearer token from Vault at
-- EXECUTION time, so rotating either secret never requires rescheduling, and
-- no credential is ever baked into migration history or cron.job rows.
-- Scheduling itself is an environment operation (like setting secrets):
-- an operator runs `select public.schedule_alert_dispatcher_v18();` once per
-- environment after storing the two Vault secrets. Timing authority is cron;
-- pg_net webhooks remain an optional fast-path optimisation.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Dispatcher health ---------------------------------------------------------
-- Readiness must not mutate the outbox: the lease/recover RPCs do real work,
-- so presence is checked against the catalog instead of by invocation. The
-- queue block is the production-support view: depth per state, the oldest
-- in-flight age, expired leases awaiting recovery, and dead-letter age.
CREATE OR REPLACE FUNCTION public.alert_dispatcher_health_v18()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schema_version text;
BEGIN
  BEGIN
    SELECT max(version) INTO v_schema_version FROM supabase_migrations.schema_migrations;
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    v_schema_version := NULL;
  END;

  RETURN jsonb_build_object(
    'lease_rpc',
      to_regprocedure('public.lease_alert_dispatches_v18(text,integer,integer)') IS NOT NULL,
    'recovery_rpc',
      to_regprocedure('public.recover_expired_alert_dispatch_leases_v18()') IS NOT NULL,
    'record_rpc',
      to_regprocedure('public.record_alert_dispatch_result_v18(uuid,text,text,text,text,text,text,boolean)') IS NOT NULL,
    'replay_rpc',
      to_regprocedure('public.replay_alert_dispatch_v18(uuid)') IS NOT NULL,
    'registry_kinds', (SELECT count(*) FROM public.owner_alert_kinds),
    'schema_version', v_schema_version,
    'queue', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending'),
        'leased', count(*) FILTER (WHERE status = 'leased'),
        'retry_wait', count(*) FILTER (WHERE status = 'retry_wait'),
        'delivery_unknown', count(*) FILTER (WHERE status = 'delivery_unknown'),
        'dead_letter', count(*) FILTER (WHERE status = 'dead_letter'),
        'expired_leases', count(*) FILTER (WHERE status = 'leased' AND lease_expires_at < now()),
        'oldest_pending_seconds', coalesce(extract(epoch FROM now() - min(created_at)
          FILTER (WHERE status IN ('pending', 'leased', 'retry_wait', 'delivery_unknown')))::bigint, 0),
        'oldest_dead_letter_seconds', coalesce(extract(epoch FROM now() - min(updated_at)
          FILTER (WHERE status = 'dead_letter'))::bigint, 0)
      )
      FROM public.alert_dispatches
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.alert_dispatcher_health_v18() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_dispatcher_health_v18() TO service_role;

-- 2. Cron invocation ------------------------------------------------------------
-- The single runtime entry the cron job executes. It RAISES when the Vault
-- secrets are missing, so a broken configuration produces visibly failed
-- cron runs (cron.job_run_details) instead of the silent no-op that
-- net.http_post(url := NULL) would be. Failing closed here means: no request
-- is sent, no lease is claimed, and the failure is operationally loud.
CREATE OR REPLACE FUNCTION public.invoke_alert_dispatcher_v18()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_token text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'alert_dispatcher_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'alert_dispatcher_token';
  IF nullif(btrim(coalesce(v_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Vault secret alert_dispatcher_url is missing; the alert dispatcher cannot be invoked.'
      USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(v_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Vault secret alert_dispatcher_token is missing; the alert dispatcher cannot be invoked.'
      USING ERRCODE = '22023';
  END IF;

  RETURN net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 25000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_alert_dispatcher_v18() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_alert_dispatcher_v18() TO service_role;

-- 3. Cron scheduling helpers -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_alert_dispatcher_v18(
  p_schedule text DEFAULT '30 seconds'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule text := nullif(btrim(coalesce(p_schedule, '')), '');
  v_job_id bigint;
BEGIN
  IF v_schedule IS NULL THEN
    RAISE EXCEPTION 'A cron schedule is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'alert_dispatcher_url') THEN
    RAISE EXCEPTION 'Vault secret alert_dispatcher_url is required before scheduling (the Edge Function invoke URL).'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'alert_dispatcher_token') THEN
    RAISE EXCEPTION 'Vault secret alert_dispatcher_token is required before scheduling (the dispatcher bearer token).'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ptm-alert-dispatcher') THEN
    PERFORM cron.unschedule('ptm-alert-dispatcher');
  END IF;

  v_job_id := cron.schedule(
    'ptm-alert-dispatcher',
    v_schedule,
    'SELECT public.invoke_alert_dispatcher_v18();'
  );

  RETURN jsonb_build_object('job_id', v_job_id, 'jobname', 'ptm-alert-dispatcher', 'schedule', v_schedule);
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_alert_dispatcher_v18(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_alert_dispatcher_v18(text) TO service_role;

CREATE OR REPLACE FUNCTION public.unschedule_alert_dispatcher_v18()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ptm-alert-dispatcher') THEN
    PERFORM cron.unschedule('ptm-alert-dispatcher');
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.unschedule_alert_dispatcher_v18() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unschedule_alert_dispatcher_v18() TO service_role;
