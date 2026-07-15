-- V18 B1 Phase 3.5: defects found during real Web Push shadow validation.
-- This migration adds no channel and changes no production cutover authority.

-- A superseded or expired verification challenge must not leave sendable debt.
CREATE OR REPLACE FUNCTION public.cancel_inactive_notification_verification_dispatch_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'expired') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.alert_dispatches
    SET status = 'cancelled',
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = 'VERIFICATION_CHALLENGE_INACTIVE',
        last_error = 'Verification challenge was superseded or expired before delivery.',
        updated_at = now()
    WHERE id = NEW.dispatch_id
      AND status IN ('pending', 'retry_wait', 'delivery_unknown');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_verification_dispatch_cancel_v18
  ON public.owner_notification_verification_challenges;
CREATE TRIGGER notification_verification_dispatch_cancel_v18
AFTER UPDATE OF status ON public.owner_notification_verification_challenges
FOR EACH ROW
EXECUTE FUNCTION public.cancel_inactive_notification_verification_dispatch_v18();

-- New verification notifications carry enough identity to reconstruct the
-- explicit confirmation control after notificationclick navigates the page.
CREATE OR REPLACE FUNCTION public.bind_notification_verification_deep_link_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.alert_dispatches
  SET payload = jsonb_set(
        payload,
        '{route}',
        to_jsonb('/admin/settings/notifications?verify=' || NEW.id::text || '&device=' || NEW.device_id::text)
      ),
      updated_at = now()
  WHERE id = NEW.dispatch_id
    AND kind = 'device_verification'
    AND channel = 'web_push';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_verification_deep_link_v18
  ON public.owner_notification_verification_challenges;
CREATE TRIGGER notification_verification_deep_link_v18
AFTER INSERT ON public.owner_notification_verification_challenges
FOR EACH ROW
EXECUTE FUNCTION public.bind_notification_verification_deep_link_v18();

-- Shadow workers lease only the channels they own. The original lease RPC is
-- retained unchanged for backwards-compatible certification and manual tools.
CREATE OR REPLACE FUNCTION public.lease_alert_dispatches_for_channels_v18(
  p_worker_id text,
  p_channels text[],
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.alert_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 60), 15), 300);
  v_channels text[] := ARRAY(
    SELECT DISTINCT btrim(channel)
    FROM unnest(coalesce(p_channels, ARRAY[]::text[])) AS channel
    WHERE nullif(btrim(channel), '') IS NOT NULL
  );
BEGIN
  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker id is required.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(array_length(v_channels, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one owned channel is required.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.alert_dispatches d
    WHERE d.status IN ('pending', 'retry_wait', 'delivery_unknown')
      AND d.channel = ANY(v_channels)
      AND d.next_attempt_at <= now()
      AND d.attempt_count < d.attempt_budget
    ORDER BY d.priority DESC, d.next_attempt_at, d.created_at, d.id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 20), 25))
  ), leased AS (
    UPDATE public.alert_dispatches d
    SET status = 'leased',
        attempt_count = d.attempt_count + 1,
        lease_owner = v_worker,
        lease_expires_at = now() + make_interval(secs => v_lease),
        updated_at = now()
    FROM candidates c
    WHERE d.id = c.id
    RETURNING d.*
  ), attempts AS (
    INSERT INTO public.alert_delivery_attempts(
      dispatch_id, attempt_number, worker_id, started_at, request_fingerprint
    )
    SELECT l.id, l.attempt_count, v_worker, now(),
      encode(extensions.digest(l.dispatch_key || ':' || l.attempt_count::text, 'sha256'), 'hex')
    FROM leased l
    RETURNING 1
  )
  SELECT * FROM leased;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_alert_dispatches_for_channels_v18(text, text[], integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_alert_dispatches_for_channels_v18(text, text[], integer, integer)
  TO service_role;
