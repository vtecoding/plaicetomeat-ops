-- V18 B1 (amended) — transactional owner-alert outbox, bounded at-least-once
-- delivery, and accurate Owner Away totals.
--
-- A critical owner_alert and the obligation to deliver it are one commit: the
-- AFTER trigger below only writes durable outbox state. Network I/O is owned by
-- a bounded dispatcher (Supabase Cron -> Edge Function every 30 seconds, with
-- an optional pg_net fast path) which leases rows with FOR UPDATE SKIP LOCKED.
--
-- Delivery is at-least-once. Every logical delivery has one stable dispatch row
-- (dispatch_key); every physical send is an alert_delivery_attempts row. An
-- ambiguous provider outcome or an abandoned lease becomes delivery_unknown and
-- is retried under the same dispatch identity — the receiving client
-- deduplicates on the dispatch id. Retries are bounded; exhaustion is a visible
-- dead_letter, never a silent drop. Provider acceptance, notification opening,
-- owner acknowledgement and resolution are four separate recorded facts.

-- 1. Fail-closed alert kind registry ------------------------------------------
-- Producers may only write kinds the canonical registry knows. The read-side
-- tray keeps its note-resolve fallback for historical rows; the write side
-- fails loudly instead of inventing permissive behaviour. This seed must stay
-- in lockstep with src/lib/domain/alert-registry.ts (verify:alert-registry).
CREATE TABLE IF NOT EXISTS public.owner_alert_kinds (
  kind text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.owner_alert_kinds(kind) VALUES
  ('operator_delivery_cost_pending'),
  ('operator_waste_reason_check'),
  ('operator_help'),
  ('help_fridge'),
  ('help_equipment'),
  ('operator_checklist_help'),
  ('checklist_skip'),
  ('operator_delivery_check_needed'),
  ('operator_delivery_unknown_product'),
  ('operator_delivery_unknown_supplier'),
  ('operator_delivery_needs_owner'),
  ('operator_sale_check_needed'),
  ('questionable_sale'),
  ('inventory_shortfall'),
  ('till_variance'),
  ('refund_above_threshold'),
  ('certificate_expiring'),
  ('backup_stale'),
  ('operator_mistake_flag'),
  ('operator_waste_unknown_product'),
  ('operator_waste_needs_owner'),
  ('operator_waste_no_matching_stock'),
  ('operator_waste_recovery_needed'),
  ('operator_evidence_review'),
  ('operator_document_review'),
  ('operator_stock_ran_out'),
  ('operator_stock_help_needed'),
  ('operator_sale_count_needed'),
  ('low_stock_during_sale'),
  ('not_opened_by_time')
ON CONFLICT (kind) DO NOTHING;

ALTER TABLE public.owner_alert_kinds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_alert_kinds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.owner_alert_kinds TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.owner_alert_kinds TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_owner_alert_kind_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.owner_alert_kinds k WHERE k.kind = NEW.kind) THEN
    RAISE EXCEPTION 'UNREGISTERED_ALERT_KIND: %', NEW.kind USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_alerts_kind_registry_guard ON public.owner_alerts;
CREATE TRIGGER owner_alerts_kind_registry_guard
BEFORE INSERT ON public.owner_alerts
FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_alert_kind_registry();

-- 2. Acknowledgement is a distinct owner fact ---------------------------------
-- Provider acceptance lives on the dispatch; seeing lives on seen_at; this is
-- the owner explicitly saying "I know". Resolution stays a separate fact.
ALTER TABLE public.owner_alerts
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid;

CREATE OR REPLACE FUNCTION public.acknowledge_owner_alert_v18(
  p_alert_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_alert public.owner_alerts%ROWTYPE;
  v_changed boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_actor;
  IF v_profile.id IS NULL
     OR NOT coalesce(v_profile.is_active, false)
     OR v_profile.role NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised to acknowledge owner alerts.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_alert
  FROM public.owner_alerts
  WHERE id = p_alert_id AND branch_id = v_profile.branch_id
  FOR UPDATE;
  IF v_alert.id IS NULL THEN
    RAISE EXCEPTION 'Owner alert not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_alert.acknowledged_at IS NULL THEN
    UPDATE public.owner_alerts
    SET acknowledged_at = now(), acknowledged_by = v_actor
    WHERE id = v_alert.id
    RETURNING * INTO v_alert;
    v_changed := true;
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES (
      'owner_alert_lifecycle_changed', 'owner_alert', v_alert.id, v_alert.branch_id, v_actor,
      jsonb_build_object('transition', 'acknowledged', 'rule', 'owner_acknowledged')
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_alert.id,
    'acknowledged_at', v_alert.acknowledged_at,
    'changed', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_owner_alert_v18(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_owner_alert_v18(uuid) TO authenticated, service_role;

-- 3. Registered owner notification devices ------------------------------------
-- Devices are the primary channel targets (Web Push / FCM, later Telegram or
-- ntfy). Credentials are stored encrypted by the privileged registration
-- endpoint; ordinary browser clients never read them back. Invalid devices are
-- disabled and kept visible — never silently deleted.
CREATE TABLE IF NOT EXISTS public.owner_notification_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web_push', 'fcm', 'telegram', 'ntfy')),

  endpoint_ciphertext text,
  auth_ciphertext text,
  p256dh_ciphertext text,
  provider_token_ciphertext text,

  device_label text,
  platform text,
  user_agent text,

  enabled boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  invalidated_at timestamptz,
  invalidation_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (owner_id, installation_id, channel)
);

CREATE INDEX IF NOT EXISTS owner_notification_devices_active_idx
  ON public.owner_notification_devices (branch_id)
  WHERE enabled AND invalidated_at IS NULL;

ALTER TABLE public.owner_notification_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_notification_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.owner_notification_devices TO service_role;

-- 4. Alert dispatch outbox -----------------------------------------------------
-- One row per logical channel delivery. dispatch_key is the stable logical
-- identity that survives every retry; the receiving client deduplicates on the
-- dispatch id. attempt_budget bounds the retry loop; manual replay extends the
-- budget on the same row instead of minting a new alert.
CREATE TABLE IF NOT EXISTS public.alert_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  alert_id uuid REFERENCES public.owner_alerts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('critical_alert', 'daily_digest')),
  channel text NOT NULL,
  device_id uuid REFERENCES public.owner_notification_devices(id) ON DELETE SET NULL,
  target text NOT NULL DEFAULT '',
  priority integer NOT NULL DEFAULT 10 CHECK (priority BETWEEN 0 AND 1000),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'leased',
      'retry_wait',
      'delivery_unknown',
      'accepted',
      'skipped',
      'cancelled',
      'dead_letter'
    )),

  dispatch_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),

  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  attempt_budget integer NOT NULL DEFAULT 6 CHECK (attempt_budget >= 1),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),

  lease_owner text,
  lease_expires_at timestamptz,

  provider_message_id text,
  provider_accepted_at timestamptz,
  notification_opened_at timestamptz,

  last_error_code text,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (
    (kind = 'critical_alert' AND alert_id IS NOT NULL)
    OR (kind = 'daily_digest' AND alert_id IS NULL)
  )
);

COMMENT ON TABLE public.alert_dispatches IS
  'V18 B1 transactional owner-notification outbox. Eligible rows are leased with FOR UPDATE SKIP LOCKED by the bounded dispatcher. At-least-once: ambiguous outcomes and abandoned leases become delivery_unknown and retry under the same dispatch identity; the client deduplicates on dispatch id. Exhaustion is a visible dead_letter.';

CREATE INDEX IF NOT EXISTS alert_dispatches_ready_idx
  ON public.alert_dispatches (priority DESC, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry_wait', 'delivery_unknown');

CREATE INDEX IF NOT EXISTS alert_dispatches_expired_lease_idx
  ON public.alert_dispatches (lease_expires_at)
  WHERE status = 'leased';

CREATE INDEX IF NOT EXISTS alert_dispatches_branch_status_idx
  ON public.alert_dispatches (branch_id, status, updated_at DESC);

ALTER TABLE public.alert_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alert_dispatches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.alert_dispatches TO service_role;

-- 5. Physical delivery attempts -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.alert_dispatches(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),

  worker_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  outcome text CHECK (outcome IN (
    'accepted',
    'rejected_permanent',
    'failed_transient',
    'ambiguous',
    'worker_abandoned'
  )),

  provider_message_id text,
  provider_status_code text,
  error_code text,
  error_detail text,

  request_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (dispatch_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS alert_delivery_attempts_dispatch_idx
  ON public.alert_delivery_attempts (dispatch_id, attempt_number DESC);

ALTER TABLE public.alert_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alert_delivery_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.alert_delivery_attempts TO service_role;

-- 6. Dispatcher heartbeat -------------------------------------------------------
-- The sender runs outside the web process. Persist what the dispatcher itself
-- observed so Setup/Away never infer delivery readiness from a different
-- environment's variables.
CREATE TABLE IF NOT EXISTS public.owner_alert_worker_status (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL,
  channel_configured boolean NOT NULL,
  target_configured boolean NOT NULL,
  last_run_ok boolean NOT NULL,
  last_error text,
  last_totals jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(last_totals) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_alert_worker_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_alert_worker_status FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.owner_alert_worker_status TO service_role;

-- 7. Retry policy ---------------------------------------------------------------
-- Attempt-relative delays; the 30-second dispatcher cadence means a scheduled
-- retry actually executes on the first sweep at or after next_attempt_at.
CREATE OR REPLACE FUNCTION public.alert_dispatch_retry_delay_seconds(
  p_next_attempt integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_next_attempt
    WHEN 1 THEN 0
    WHEN 2 THEN 15
    WHEN 3 THEN 30
    WHEN 4 THEN 60
    WHEN 5 THEN 120
    WHEN 6 THEN 240
    ELSE NULL
  END;
$$;

-- 8. Wake signal ----------------------------------------------------------------
-- NOTIFY is a hint, never the queue. The optional pg_net webhook and any live
-- listener use it as a fast path; the 30-second sweep is the durable authority.
CREATE OR REPLACE FUNCTION public.notify_alert_dispatch_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'alert_dispatch_pending',
    json_build_object('dispatch_id', NEW.id, 'priority', NEW.priority)::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alert_dispatches_notify_pending ON public.alert_dispatches;
CREATE TRIGGER alert_dispatches_notify_pending
AFTER INSERT ON public.alert_dispatches
FOR EACH ROW EXECUTE FUNCTION public.notify_alert_dispatch_pending();

-- 9. Not-opened-by-time producer -------------------------------------------------
ALTER TABLE public.branch_operator_settings
  ADD COLUMN IF NOT EXISTS expected_open_time time NOT NULL DEFAULT '09:00';

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_not_opened_day_uniq
  ON public.owner_alerts (branch_id, kind, entity_ref)
  WHERE kind = 'not_opened_by_time';

-- Deterministic D-4 producer. The dispatcher invokes this every sweep. Branch-
-- local time is DST-correct, and a configured shop closure suppresses the alert.
CREATE OR REPLACE FUNCTION public.scan_not_opened_by_time_v18(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH due AS (
    SELECT
      b.id AS branch_id,
      (p_now AT TIME ZONE coalesce(b.timezone, 'Europe/London'))::date AS business_date,
      coalesce(s.expected_open_time, '09:00'::time) AS expected_open_time
    FROM public.branches b
    LEFT JOIN public.branch_operator_settings s ON s.branch_id = b.id
    WHERE (p_now AT TIME ZONE coalesce(b.timezone, 'Europe/London'))::time
            >= coalesce(s.expected_open_time, '09:00'::time)
      AND NOT EXISTS (
        SELECT 1 FROM public.shop_closures c
        WHERE c.branch_id = b.id
          AND c.close_date = (p_now AT TIME ZONE coalesce(b.timezone, 'Europe/London'))::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.ops_checklist_sessions cs
        WHERE cs.branch_id = b.id
          AND cs.kind = 'opening'
          AND cs.business_date = (p_now AT TIME ZONE coalesce(b.timezone, 'Europe/London'))::date
          AND cs.status = 'completed'
      )
  ), inserted AS (
    INSERT INTO public.owner_alerts(branch_id, severity, kind, summary, entity_ref, created_by)
    SELECT
      d.branch_id,
      'critical',
      'not_opened_by_time',
      'The shop has not saved its opening checks by ' || to_char(d.expected_open_time, 'HH24:MI') || '.',
      'opening:' || d.business_date::text,
      NULL
    FROM due d
    ON CONFLICT (branch_id, kind, entity_ref) WHERE kind = 'not_opened_by_time' DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_not_opened_by_time_v18(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_not_opened_by_time_v18(timestamptz) TO service_role;

-- 10. Critical alert fan-out -----------------------------------------------------
-- A critical alert becomes externally owed in the same transaction. One legacy
-- channel row always exists (visible delivery debt even with nothing
-- configured), plus one row per active verified device. Duplicate producer
-- replay converges upstream on the owner_alerts uniqueness; a dispatch_key
-- collision here therefore means the key is owned by DIFFERENT work and must
-- roll the alert back rather than silently satisfy the delivery debt.
CREATE OR REPLACE FUNCTION public.enqueue_critical_owner_alert_dispatch_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target text := '';
BEGIN
  IF NEW.severity <> 'critical' THEN
    RETURN NEW;
  END IF;

  -- A warning which later escalates to critical becomes externally owed once.
  IF TG_OP = 'UPDATE' AND OLD.severity = 'critical' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(owner_contact, '') INTO v_target
  FROM public.branch_operator_settings
  WHERE branch_id = NEW.branch_id;

  INSERT INTO public.alert_dispatches(
    branch_id, alert_id, kind, channel, target, priority, status,
    dispatch_key, payload, next_attempt_at
  )
  VALUES (
    NEW.branch_id,
    NEW.id,
    'critical_alert',
    'twilio_whatsapp',
    coalesce(v_target, ''),
    100,
    'pending',
    'critical-alert:' || NEW.id::text,
    jsonb_build_object(
      'message', NEW.summary,
      'alert_kind', NEW.kind,
      'entity_ref', NEW.entity_ref
    ),
    now()
  );

  INSERT INTO public.alert_dispatches(
    branch_id, alert_id, kind, channel, device_id, target, priority, status,
    dispatch_key, payload, next_attempt_at
  )
  SELECT
    NEW.branch_id,
    NEW.id,
    'critical_alert',
    d.channel,
    d.id,
    '',
    100,
    'pending',
    'critical-alert:' || NEW.id::text || ':' || d.channel || ':' || d.id::text,
    jsonb_build_object(
      'message', NEW.summary,
      'alert_kind', NEW.kind,
      'entity_ref', NEW.entity_ref
    ),
    now()
  FROM public.owner_notification_devices d
  WHERE d.branch_id = NEW.branch_id
    AND d.enabled
    AND d.verified_at IS NOT NULL
    AND d.invalidated_at IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_alert_enqueue_critical_dispatch_v18 ON public.owner_alerts;
CREATE TRIGGER owner_alert_enqueue_critical_dispatch_v18
AFTER INSERT OR UPDATE OF severity ON public.owner_alerts
FOR EACH ROW EXECUTE FUNCTION public.enqueue_critical_owner_alert_dispatch_v18();

-- D-4: an ordinary closing mismatch is a warning, but a cash short greater than
-- three times the branch threshold interrupts immediately. A1 keeps the money
-- calculation; this trigger owns only delivery classification.
CREATE OR REPLACE FUNCTION public.escalate_large_till_short_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match text[];
  v_short_pence integer;
  v_threshold integer := 500;
BEGIN
  IF NEW.kind <> 'till_variance' OR NEW.severity <> 'warning' THEN
    RETURN NEW;
  END IF;
  v_match := regexp_match(NEW.summary, 'Till was £([0-9]+(?:\.[0-9]{1,2})?) short', 'i');
  IF v_match IS NULL THEN
    RETURN NEW;
  END IF;
  v_short_pence := round((v_match[1])::numeric * 100)::integer;
  SELECT coalesce(bs.till_variance_alert_pence, 500) INTO v_threshold
  FROM public.branch_settings bs WHERE bs.branch_id = NEW.branch_id;
  v_threshold := coalesce(v_threshold, 500);
  IF v_short_pence > 3 * v_threshold THEN
    UPDATE public.owner_alerts SET severity = 'critical' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_alert_escalate_large_till_short_v18 ON public.owner_alerts;
CREATE TRIGGER owner_alert_escalate_large_till_short_v18
AFTER INSERT ON public.owner_alerts
FOR EACH ROW EXECUTE FUNCTION public.escalate_large_till_short_v18();

-- 11. Leasing -------------------------------------------------------------------
-- Atomically lease a bounded batch. SKIP LOCKED is the concurrency authority;
-- overlapping dispatcher invocations contend on rows, never on a session lock.
-- Leasing increments attempt_count and opens the physical attempt record.
CREATE OR REPLACE FUNCTION public.lease_alert_dispatches_v18(
  p_worker_id text,
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
BEGIN
  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker id is required.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.alert_dispatches d
    WHERE d.status IN ('pending', 'retry_wait', 'delivery_unknown')
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
    SELECT
      l.id,
      l.attempt_count,
      v_worker,
      now(),
      encode(extensions.digest(l.dispatch_key || ':' || l.attempt_count::text, 'sha256'), 'hex')
    FROM leased l
    RETURNING 1
  )
  SELECT * FROM leased;
END;
$$;

REVOKE ALL ON FUNCTION public.lease_alert_dispatches_v18(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_alert_dispatches_v18(text, integer, integer) TO service_role;

-- 12. Lease recovery -------------------------------------------------------------
-- An abandoned lease is never converted into permanent failure. The dispatch
-- becomes delivery_unknown (retryable under the same identity) unless its
-- bounded budget is already exhausted, in which case it is a visible
-- dead_letter. The open attempt is closed as worker_abandoned.
CREATE OR REPLACE FUNCTION public.recover_expired_alert_dispatch_leases_v18()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH expired AS (
    SELECT d.id, d.attempt_count, d.attempt_budget
    FROM public.alert_dispatches d
    WHERE d.status = 'leased'
      AND d.lease_expires_at IS NOT NULL
      AND d.lease_expires_at < now()
    FOR UPDATE SKIP LOCKED
  ), recovered AS (
    UPDATE public.alert_dispatches d
    SET status = CASE
          WHEN e.attempt_count >= e.attempt_budget THEN 'dead_letter'
          ELSE 'delivery_unknown'
        END,
        next_attempt_at = now(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = 'WORKER_ABANDONED',
        last_error = 'Lease expired before the worker recorded a result; retried under the same dispatch identity.',
        updated_at = now()
    FROM expired e
    WHERE d.id = e.id
    RETURNING d.id, d.attempt_count
  ), closed AS (
    UPDATE public.alert_delivery_attempts a
    SET completed_at = now(),
        outcome = 'worker_abandoned',
        error_code = 'WORKER_ABANDONED'
    FROM recovered r
    WHERE a.dispatch_id = r.id
      AND a.attempt_number = r.attempt_count
      AND a.completed_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM recovered;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_expired_alert_dispatch_leases_v18() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_expired_alert_dispatch_leases_v18() TO service_role;

-- 13. Record one send outcome -----------------------------------------------------
-- Transient failures back off on the attempt-relative schedule with bounded
-- jitter; ambiguous outcomes stay retryable as delivery_unknown; permanent
-- rejections and exhausted budgets are visible dead letters. Terminal states
-- are idempotent to re-record.
CREATE OR REPLACE FUNCTION public.record_alert_dispatch_result_v18(
  p_dispatch_id uuid,
  p_worker_id text,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status_code text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_detail text DEFAULT NULL,
  p_invalidate_device boolean DEFAULT false
)
RETURNS public.alert_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.alert_dispatches%ROWTYPE;
  v_worker text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_next_delay integer;
  v_jitter numeric;
  v_attempt_outcome text;
BEGIN
  IF p_outcome NOT IN ('accepted', 'skipped', 'rejected_permanent', 'failed_transient', 'ambiguous') THEN
    RAISE EXCEPTION 'Invalid dispatch outcome.' USING ERRCODE = '22023';
  END IF;
  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker id is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.alert_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Dispatch not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IN ('accepted', 'skipped', 'cancelled', 'dead_letter') THEN
    RETURN v_row;
  END IF;
  IF v_row.status <> 'leased' OR v_row.lease_owner IS DISTINCT FROM v_worker THEN
    RAISE EXCEPTION 'Dispatch lease is not held by this worker.' USING ERRCODE = '55000';
  END IF;

  v_attempt_outcome := CASE p_outcome
    WHEN 'accepted' THEN 'accepted'
    WHEN 'skipped' THEN 'rejected_permanent'
    ELSE p_outcome
  END;

  UPDATE public.alert_delivery_attempts a
  SET completed_at = now(),
      outcome = v_attempt_outcome,
      provider_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), ''),
      provider_status_code = nullif(btrim(coalesce(p_provider_status_code, '')), ''),
      error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
      error_detail = nullif(left(btrim(coalesce(p_error_detail, '')), 1000), '')
  WHERE a.dispatch_id = v_row.id
    AND a.attempt_number = v_row.attempt_count
    AND a.completed_at IS NULL;

  IF p_outcome = 'accepted' THEN
    UPDATE public.alert_dispatches
    SET status = 'accepted',
        provider_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), ''),
        provider_accepted_at = now(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    IF v_row.device_id IS NOT NULL THEN
      UPDATE public.owner_notification_devices
      SET last_success_at = now(), consecutive_failures = 0, updated_at = now()
      WHERE id = v_row.device_id;
    END IF;
    RETURN v_row;
  END IF;

  IF p_outcome = 'skipped' THEN
    UPDATE public.alert_dispatches
    SET status = 'skipped',
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = coalesce(nullif(btrim(coalesce(p_error_code, '')), ''), 'CHANNEL_DISABLED'),
        last_error = nullif(left(btrim(coalesce(p_error_detail, '')), 1000), ''),
        updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  IF v_row.device_id IS NOT NULL THEN
    UPDATE public.owner_notification_devices
    SET last_failure_at = now(),
        consecutive_failures = consecutive_failures + 1,
        enabled = CASE WHEN p_invalidate_device THEN false ELSE enabled END,
        invalidated_at = CASE
          WHEN p_invalidate_device THEN coalesce(invalidated_at, now())
          ELSE invalidated_at
        END,
        invalidation_reason = CASE
          WHEN p_invalidate_device THEN coalesce(invalidation_reason, nullif(btrim(coalesce(p_error_code, '')), ''))
          ELSE invalidation_reason
        END,
        updated_at = now()
    WHERE id = v_row.device_id;
  END IF;

  IF p_outcome = 'rejected_permanent' OR v_row.attempt_count >= v_row.attempt_budget THEN
    UPDATE public.alert_dispatches
    SET status = 'dead_letter',
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
        last_error = nullif(left(btrim(coalesce(p_error_detail, '')), 1000), ''),
        updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  v_next_delay := public.alert_dispatch_retry_delay_seconds(v_row.attempt_count + 1);
  v_jitter := random() * least(5, coalesce(v_next_delay, 0) * 0.2);

  UPDATE public.alert_dispatches
  SET status = CASE WHEN p_outcome = 'ambiguous' THEN 'delivery_unknown' ELSE 'retry_wait' END,
      next_attempt_at = now() + make_interval(secs => coalesce(v_next_delay, 0) + v_jitter),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
      last_error = nullif(left(btrim(coalesce(p_error_detail, '')), 1000), ''),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_alert_dispatch_result_v18(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_alert_dispatch_result_v18(uuid, text, text, text, text, text, text, boolean) TO service_role;

-- 14. Notification opened ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_alert_notification_opened_v18(
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
  UPDATE public.alert_dispatches
  SET notification_opened_at = coalesce(notification_opened_at, now()),
      updated_at = now()
  WHERE id = p_dispatch_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Dispatch not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_alert_notification_opened_v18(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_alert_notification_opened_v18(uuid) TO service_role;

-- 15. Manual replay ----------------------------------------------------------------
-- Replay re-arms the SAME dispatch row with a fresh bounded budget. It never
-- creates a new owner alert, and attempt history is preserved because attempt
-- numbers keep increasing.
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
  IF v_row.status NOT IN ('dead_letter', 'skipped', 'cancelled') THEN
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

-- 16. Digest enqueue ----------------------------------------------------------------
-- One scheduled digest per branch/business-day. Immediate Owner Away digests
-- pass a separate, stable key for that toggle event. Digest device fan-out
-- arrives with the PWA registration flow (Phase 3); until then the digest is a
-- single legacy-channel dispatch.
CREATE OR REPLACE FUNCTION public.enqueue_owner_digest_dispatch_v18(
  p_branch_id uuid,
  p_business_date date,
  p_target text,
  p_payload jsonb,
  p_dispatch_key text DEFAULT NULL
)
RETURNS public.alert_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.alert_dispatches%ROWTYPE;
  v_key text := coalesce(
    nullif(btrim(coalesce(p_dispatch_key, '')), ''),
    'digest:' || p_branch_id::text || ':' || p_business_date::text
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'Branch not found.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
     OR NOT coalesce(p_payload, '{}'::jsonb) ? 'message' THEN
    RAISE EXCEPTION 'Digest message is required.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.alert_dispatches(
    branch_id, alert_id, kind, channel, target, priority, status,
    dispatch_key, payload, next_attempt_at
  )
  VALUES (
    p_branch_id, NULL, 'daily_digest', 'twilio_whatsapp',
    coalesce(p_target, ''), 10, 'pending', v_key, p_payload, now()
  )
  ON CONFLICT (dispatch_key) DO UPDATE
    SET dispatch_key = excluded.dispatch_key
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_owner_digest_dispatch_v18(uuid, date, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_owner_digest_dispatch_v18(uuid, date, text, jsonb, text) TO service_role;

-- 17. Owner Away -----------------------------------------------------------------
-- Toggle Owner Away without resetting the window on a replay. Returning the
-- stable away_since lets the app use one digest key for the actual off -> on
-- transition; concurrent/double submissions therefore converge on one row.
CREATE OR REPLACE FUNCTION public.set_owner_away_mode_v18(
  p_branch_id uuid,
  p_owner_away boolean,
  p_updated_by uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.branch_operator_settings%ROWTYPE;
  v_changed boolean := false;
  v_now timestamptz := coalesce(p_now, now());
BEGIN
  IF p_owner_away IS NULL THEN
    RAISE EXCEPTION 'Owner Away state is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'Branch not found.' USING ERRCODE = 'P0002';
  END IF;

  -- A settings row may not exist yet, so there is no row lock to serialize two
  -- first-time off -> on requests. The branch-scoped advisory lock makes that
  -- creation path converge on one away_since and one immediate digest key.
  PERFORM pg_advisory_xact_lock(hashtextextended('owner-away:' || p_branch_id::text, 0));

  SELECT * INTO v_row
  FROM public.branch_operator_settings
  WHERE branch_id = p_branch_id
  FOR UPDATE;

  IF v_row.branch_id IS NULL THEN
    IF NOT p_owner_away THEN
      RETURN jsonb_build_object('owner_away', false, 'away_since', NULL, 'changed', false);
    END IF;
    INSERT INTO public.branch_operator_settings(
      branch_id, owner_away, away_since, updated_at, updated_by
    )
    VALUES (
      p_branch_id,
      p_owner_away,
      CASE WHEN p_owner_away THEN v_now ELSE NULL END,
      v_now,
      p_updated_by
    )
    RETURNING * INTO v_row;
    v_changed := p_owner_away;
  ELSIF v_row.owner_away IS DISTINCT FROM p_owner_away THEN
    UPDATE public.branch_operator_settings
    SET owner_away = p_owner_away,
        away_since = CASE WHEN p_owner_away THEN v_now ELSE NULL END,
        updated_at = v_now,
        updated_by = p_updated_by
    WHERE branch_id = p_branch_id
    RETURNING * INTO v_row;
    v_changed := true;
  END IF;

  IF v_changed THEN
    INSERT INTO public.audit_logs(
      event_type, target_type, target_id, branch_id, actor_id, metadata
    )
    VALUES (
      'branch_settings_updated',
      'branch_operator_settings',
      p_branch_id,
      p_branch_id,
      p_updated_by,
      jsonb_build_object('owner_away', p_owner_away, 'source', 'owner_away_mode')
    );
  END IF;

  RETURN jsonb_build_object(
    'owner_away', v_row.owner_away,
    'away_since', v_row.away_since,
    'changed', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_owner_away_mode_v18(uuid, boolean, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_owner_away_mode_v18(uuid, boolean, uuid, timestamptz) TO service_role;

-- Production action boundary: the off->on transition, transition audit and
-- immediate digest debt are one transaction. The payload is composed before
-- entry; if the outbox cannot accept it, the setting change also rolls back.
CREATE OR REPLACE FUNCTION public.set_owner_away_mode_with_digest_v18(
  p_branch_id uuid,
  p_owner_away boolean,
  p_updated_by uuid,
  p_business_date date,
  p_target text,
  p_payload jsonb,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state jsonb;
  v_key text;
  v_dispatch public.alert_dispatches%ROWTYPE;
BEGIN
  IF p_owner_away AND (
    p_business_date IS NULL
    OR jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
    OR NOT coalesce(p_payload, '{}'::jsonb) ? 'message'
  ) THEN
    RAISE EXCEPTION 'Immediate Owner Away digest is required.' USING ERRCODE = '22023';
  END IF;

  v_state := public.set_owner_away_mode_v18(
    p_branch_id, p_owner_away, p_updated_by, p_now
  );
  IF NOT p_owner_away THEN
    RETURN v_state || jsonb_build_object('digest_id', NULL);
  END IF;

  v_key := 'digest-away:' || p_branch_id::text || ':' || (v_state->>'away_since');
  SELECT * INTO v_dispatch
  FROM public.alert_dispatches
  WHERE dispatch_key = v_key;

  IF v_dispatch.id IS NULL THEN
    v_dispatch := public.enqueue_owner_digest_dispatch_v18(
      p_branch_id,
      p_business_date,
      coalesce(p_target, ''),
      p_payload,
      v_key
    );
  ELSIF v_dispatch.branch_id <> p_branch_id
     OR v_dispatch.kind <> 'daily_digest'
     OR v_dispatch.alert_id IS NOT NULL THEN
    RAISE EXCEPTION 'Immediate digest key is already owned by different work.' USING ERRCODE = '23505';
  END IF;

  RETURN v_state || jsonb_build_object('digest_id', v_dispatch.id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_owner_away_mode_with_digest_v18(uuid, boolean, uuid, date, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_owner_away_mode_with_digest_v18(uuid, boolean, uuid, date, text, jsonb, timestamptz)
  TO service_role;

-- 18. Aggregate truth for Owner Away. Preview rows remain bounded in the app,
-- but counts and sums never derive from those caps.
CREATE OR REPLACE FUNCTION public.owner_away_aggregates_v18(
  p_branch_id uuid,
  p_since timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'order_count', (
      SELECT count(DISTINCT pe.order_id)
      FROM public.payment_events pe
      JOIN public.orders o ON o.id = pe.order_id
      WHERE pe.branch_id = p_branch_id AND pe.created_at >= p_since
        AND pe.direction = 'sale' AND coalesce(o.is_test, false) = false
    ),
    'revenue', (
      -- Net collected takings in the exact away window. Sale amounts are
      -- frozen from the canonical effective order at collection; refunds are
      -- explicit compensating money facts and reduce the displayed total.
      SELECT coalesce(sum(
        CASE WHEN pe.direction = 'sale' THEN pe.amount_pence ELSE -pe.amount_pence END
      ), 0)::numeric / 100
      FROM public.payment_events pe
      JOIN public.orders o ON o.id = pe.order_id
      WHERE pe.branch_id = p_branch_id AND pe.created_at >= p_since
        AND coalesce(o.is_test, false) = false
    ),
    'delivery_count', (
      SELECT count(*) FROM public.inventory_batches b
      JOIN public.products p ON p.id = b.product_id
      WHERE b.branch_id = p_branch_id AND b.created_at >= p_since
        AND p.inventory_policy = 'kg_batch'
    ),
    'delivered_kg', (
      SELECT coalesce(sum(b.received_weight_kg), 0) FROM public.inventory_batches b
      JOIN public.products p ON p.id = b.product_id
      WHERE b.branch_id = p_branch_id AND b.created_at >= p_since
        AND p.inventory_policy = 'kg_batch'
    ),
    'waste_count', (
      SELECT count(*) FROM public.inventory_movements m
      JOIN public.inventory_batches b ON b.id = m.batch_id
      JOIN public.products p ON p.id = b.product_id
      WHERE m.branch_id = p_branch_id AND m.created_at >= p_since AND m.movement_type = 'WASTE'
        AND p.inventory_policy = 'kg_batch'
    ),
    'waste_kg', (
      SELECT coalesce(sum(m.quantity_kg), 0) FROM public.inventory_movements m
      JOIN public.inventory_batches b ON b.id = m.batch_id
      JOIN public.products p ON p.id = b.product_id
      WHERE m.branch_id = p_branch_id AND m.created_at >= p_since AND m.movement_type = 'WASTE'
        AND p.inventory_policy = 'kg_batch'
    ),
    'sale_kg', (
      SELECT coalesce(sum(m.quantity_kg), 0) FROM public.inventory_movements m
      JOIN public.inventory_batches b ON b.id = m.batch_id
      JOIN public.products p ON p.id = b.product_id
      WHERE m.branch_id = p_branch_id AND m.created_at >= p_since AND m.movement_type = 'SALE'
        AND p.inventory_policy = 'kg_batch'
    ),
    'serve_count', (
      SELECT count(*) FROM public.operator_workflow_runs r
      WHERE r.branch_id = p_branch_id AND r.updated_at >= p_since AND r.workflow = 'serve' AND r.status = 'completed'
    ),
    'delivery_workflow_count', (
      SELECT count(*) FROM public.operator_workflow_runs r
      WHERE r.branch_id = p_branch_id AND r.updated_at >= p_since AND r.workflow = 'delivery' AND r.status = 'completed'
    ),
    'waste_workflow_count', (
      SELECT count(*) FROM public.operator_workflow_runs r
      WHERE r.branch_id = p_branch_id AND r.updated_at >= p_since AND r.workflow = 'waste' AND r.status = 'completed'
    ),
    'certificate_workflow_count', (
      SELECT count(*) FROM public.operator_workflow_runs r
      WHERE r.branch_id = p_branch_id AND r.updated_at >= p_since AND r.workflow = 'certificate' AND r.status = 'completed'
    ),
    'evidence_total', (
      SELECT count(*) FROM public.operator_evidence e
      WHERE e.branch_id = p_branch_id AND e.created_at >= p_since
    ),
    'evidence_needs_review', (
      SELECT count(*) FROM public.operator_evidence e
      WHERE e.branch_id = p_branch_id AND e.created_at >= p_since
        AND (coalesce(e.review_required, false) OR e.status = 'needs_owner_review')
    ),
    'evidence_failed', (
      SELECT count(*) FROM public.operator_evidence e
      WHERE e.branch_id = p_branch_id AND e.created_at >= p_since AND e.status = 'failed'
    ),
    'certificate_captured', (
      SELECT count(*) FROM public.compliance_documents d
      WHERE d.branch_id = p_branch_id AND d.created_at >= p_since
    ),
    'certificate_needs_review', (
      SELECT count(*) FROM public.compliance_documents d
      WHERE d.branch_id = p_branch_id AND d.created_at >= p_since AND d.status = 'needs_owner_review'
    ),
    'open_alert_count', (
      SELECT count(*) FROM public.owner_alerts a
      WHERE a.branch_id = p_branch_id AND a.resolved_at IS NULL
    ),
    'critical_alert_count', (
      SELECT count(*) FROM public.owner_alerts a
      WHERE a.branch_id = p_branch_id AND a.resolved_at IS NULL AND a.severity = 'critical'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.owner_away_aggregates_v18(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_away_aggregates_v18(uuid, timestamptz) TO service_role;

-- Bounded preview backed by the same payment ledger. It deliberately shows
-- each sale's frozen collection amount (gross); the aggregate above is net of
-- refunds. Unpaid incoming/ready orders never enter either sales surface.
CREATE OR REPLACE FUNCTION public.owner_away_latest_sales_v18(
  p_branch_id uuid,
  p_since timestamptz,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  order_ref text,
  subtotal numeric,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.order_ref,
    sum(pe.amount_pence)::numeric / 100 AS subtotal,
    max(pe.created_at) AS created_at
  FROM public.payment_events pe
  JOIN public.orders o ON o.id = pe.order_id
  WHERE pe.branch_id = p_branch_id
    AND pe.created_at >= p_since
    AND pe.direction = 'sale'
    AND coalesce(o.is_test, false) = false
  GROUP BY o.id, o.order_ref
  ORDER BY max(pe.created_at) DESC, o.id
  LIMIT least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

REVOKE ALL ON FUNCTION public.owner_away_latest_sales_v18(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_away_latest_sales_v18(uuid, timestamptz, integer) TO service_role;

-- 19. One database snapshot for the scheduled digest. Every day filter is branch
-- local: ledgers use their stamped business_date, other event tables use the
-- DST-correct branch_business_date helper.
CREATE OR REPLACE FUNCTION public.owner_digest_snapshot_v18(
  p_branch_id uuid,
  p_business_date date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH opened AS (
    SELECT coalesce(p.full_name, p.email, 'shop staff') AS actor
    FROM public.ops_checklist_sessions s
    LEFT JOIN public.profiles p ON p.id = s.completed_by
    WHERE s.branch_id = p_branch_id AND s.business_date = p_business_date
      AND s.kind = 'opening' AND s.status = 'completed'
    ORDER BY s.completed_at DESC NULLS LAST
    LIMIT 1
  ), closed AS (
    SELECT coalesce(p.full_name, p.email, 'shop staff') AS actor,
           s.completion_metadata
    FROM public.ops_checklist_sessions s
    LEFT JOIN public.profiles p ON p.id = s.completed_by
    WHERE s.branch_id = p_branch_id AND s.business_date = p_business_date
      AND s.kind = 'closing' AND s.status = 'completed'
    ORDER BY s.completed_at DESC NULLS LAST
    LIMIT 1
  ), money AS (
    SELECT
      coalesce(sum(pe.amount_pence) FILTER (WHERE pe.method = 'cash' AND pe.direction = 'sale'), 0)
        - coalesce(sum(pe.amount_pence) FILTER (WHERE pe.method = 'cash' AND pe.direction = 'refund'), 0) AS cash_pence,
      coalesce(sum(pe.amount_pence) FILTER (WHERE pe.method = 'card' AND pe.direction = 'sale'), 0)
        - coalesce(sum(pe.amount_pence) FILTER (WHERE pe.method = 'card' AND pe.direction = 'refund'), 0) AS card_pence
    FROM public.payment_events pe
    WHERE pe.branch_id = p_branch_id AND pe.business_date = p_business_date
  )
  SELECT jsonb_build_object(
    'business_date', p_business_date,
    'opened_by', (SELECT actor FROM opened),
    'closed_by', (SELECT actor FROM closed),
    'cash_takings_pence', (SELECT cash_pence FROM money),
    'card_takings_pence', (SELECT card_pence FROM money),
    'total_takings_pence', (SELECT cash_pence + card_pence FROM money),
    'cash_variance_pence', (
      SELECT (completion_metadata->>'cash_variance_pence')::integer FROM closed
    ),
    'card_variance_pence', (
      SELECT (completion_metadata->>'card_variance_pence')::integer FROM closed
    ),
    'delivery_count', (
      SELECT count(*) FROM public.inventory_batches b
      JOIN public.products p ON p.id = b.product_id
      WHERE b.branch_id = p_branch_id AND b.received_date = p_business_date
        AND p.inventory_policy = 'kg_batch'
    ),
    'pending_delivery_costs', (
      SELECT count(*) FROM public.inventory_batches b
      JOIN public.products p ON p.id = b.product_id
      WHERE b.branch_id = p_branch_id AND b.received_date = p_business_date
        AND coalesce(b.invoice_cost, 0) <= 0
        AND p.inventory_policy = 'kg_batch'
    ),
    'waste_count', (
      SELECT count(*) FROM public.inventory_movements m
      JOIN public.inventory_batches b ON b.id = m.batch_id
      JOIN public.products p ON p.id = b.product_id
      WHERE m.branch_id = p_branch_id AND m.movement_type = 'WASTE'
        AND public.branch_business_date(p_branch_id, m.created_at) = p_business_date
        AND p.inventory_policy = 'kg_batch'
    ),
    'waste_kg', (
      SELECT coalesce(sum(m.quantity_kg), 0) FROM public.inventory_movements m
      JOIN public.inventory_batches b ON b.id = m.batch_id
      JOIN public.products p ON p.id = b.product_id
      WHERE m.branch_id = p_branch_id AND m.movement_type = 'WASTE'
        AND public.branch_business_date(p_branch_id, m.created_at) = p_business_date
        AND p.inventory_policy = 'kg_batch'
    ),
    'shortfall_count', (
      SELECT count(*) FROM public.order_inventory_depletions d
      WHERE d.branch_id = p_branch_id AND d.shortfall_kg > 0
        AND public.branch_business_date(p_branch_id, d.created_at) = p_business_date
    ),
    'open_alert_count', (
      SELECT count(*) FROM public.owner_alerts a
      WHERE a.branch_id = p_branch_id AND a.resolved_at IS NULL
    )
  );
$$;

REVOKE ALL ON FUNCTION public.owner_digest_snapshot_v18(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_digest_snapshot_v18(uuid, date) TO service_role;
