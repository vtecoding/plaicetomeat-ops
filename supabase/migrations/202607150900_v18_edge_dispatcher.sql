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
-- so presence is checked against the catalog instead of by invocation.
CREATE OR REPLACE FUNCTION public.alert_dispatcher_health_v18()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'lease_rpc',
      to_regprocedure('public.lease_alert_dispatches_v18(text,integer,integer)') IS NOT NULL,
    'recovery_rpc',
      to_regprocedure('public.recover_expired_alert_dispatch_leases_v18()') IS NOT NULL,
    'record_rpc',
      to_regprocedure('public.record_alert_dispatch_result_v18(uuid,text,text,text,text,text,text,boolean)') IS NOT NULL,
    'replay_rpc',
      to_regprocedure('public.replay_alert_dispatch_v18(uuid)') IS NOT NULL,
    'registry_kinds', (SELECT count(*) FROM public.owner_alert_kinds)
  );
$$;

REVOKE ALL ON FUNCTION public.alert_dispatcher_health_v18() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_dispatcher_health_v18() TO service_role;

-- 2. Cron scheduling helpers -----------------------------------------------------
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
    $cmd$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alert_dispatcher_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alert_dispatcher_token'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('source', 'cron'),
      timeout_milliseconds := 25000
    )
    $cmd$
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
