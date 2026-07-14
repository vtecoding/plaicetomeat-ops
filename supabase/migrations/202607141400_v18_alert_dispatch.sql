-- V18 B1 — transactional owner-alert outbox and accurate Owner Away totals.
--
-- A critical owner_alert and the obligation to deliver it are one commit: the
-- AFTER trigger below only writes durable outbox state. Network I/O is owned by
-- a bounded worker which leases rows with FOR UPDATE SKIP LOCKED. The durable
-- provider key is stable for an adapter which can honour it. Twilio Messages
-- cannot: its adapter therefore persists send_started_at before I/O and makes
-- any ambiguous/crashed attempt terminal-visible instead of blindly retrying.

ALTER TABLE public.owner_alerts
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE TABLE IF NOT EXISTS public.alert_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  alert_id uuid REFERENCES public.owner_alerts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('critical_alert', 'daily_digest')),
  channel text NOT NULL,
  target text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  provider_response text,
  send_started_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'critical_alert' AND alert_id IS NOT NULL)
    OR (kind = 'daily_digest' AND alert_id IS NULL)
  )
);

-- The sender runs in GitHub Actions, not in the web process. Persist what the
-- worker itself observed so Setup/Away never infer delivery readiness from a
-- different environment's variables.
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

COMMENT ON TABLE public.alert_dispatches IS
  'V18 B1 transactional owner-notification outbox. Pending/retryable rows are leased by the bounded worker. Providers without documented idempotency use a durable send boundary and terminal-visible ambiguous outcomes.';

ALTER TABLE public.branch_operator_settings
  ADD COLUMN IF NOT EXISTS expected_open_time time NOT NULL DEFAULT '09:00';

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_not_opened_day_uniq
  ON public.owner_alerts (branch_id, kind, entity_ref)
  WHERE kind = 'not_opened_by_time';

-- Deterministic D-4 producer. The worker invokes this every sweep. Branch-local
-- time is DST-correct, and a configured shop closure suppresses the alert.
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

CREATE INDEX IF NOT EXISTS alert_dispatches_due_idx
  ON public.alert_dispatches (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS alert_dispatches_branch_status_idx
  ON public.alert_dispatches (branch_id, status, updated_at DESC);

ALTER TABLE public.alert_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alert_dispatches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.alert_dispatches TO service_role;

ALTER TABLE public.owner_alert_worker_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_alert_worker_status FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.owner_alert_worker_status TO service_role;

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
    branch_id, alert_id, kind, channel, target, status,
    provider_idempotency_key, payload, next_attempt_at
  )
  VALUES (
    NEW.branch_id,
    NEW.id,
    'critical_alert',
    'twilio_whatsapp',
    coalesce(v_target, ''),
    'pending',
    'critical-alert:' || NEW.id::text,
    jsonb_build_object(
      'message', NEW.summary,
      'alert_kind', NEW.kind,
      'entity_ref', NEW.entity_ref
    ),
    now()
  );

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

-- Atomically lease a bounded sweep. Leases are represented by next_attempt_at;
-- if a worker dies after claiming, the same row becomes retryable after 5 min.
CREATE OR REPLACE FUNCTION public.claim_alert_dispatches_v18(
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.alert_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.alert_dispatches d
    WHERE d.attempts < 5
      AND d.send_started_at IS NULL
      AND (
        (d.status = 'pending' AND coalesce(d.next_attempt_at, d.created_at) <= now())
        OR (d.status = 'failed' AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= now())
      )
    ORDER BY coalesce(d.next_attempt_at, d.created_at), d.created_at, d.id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 25))
  ), leased AS (
    UPDATE public.alert_dispatches d
    SET next_attempt_at = now() + interval '5 minutes',
        updated_at = now()
    FROM candidates c
    WHERE d.id = c.id
    RETURNING d.*
  )
  SELECT * FROM leased;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_alert_dispatches_v18(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_alert_dispatches_v18(integer) TO service_role;

-- Twilio Messages does not document a client idempotency key. Persist the
-- attempt boundary before network I/O. If the worker dies after this point, the
-- stale attempt becomes a terminal-visible ambiguous failure and is never
-- blindly resent.
CREATE OR REPLACE FUNCTION public.begin_alert_dispatch_attempt_v18(
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
  SET send_started_at = now(), updated_at = now()
  WHERE id = p_dispatch_id
    AND status IN ('pending', 'failed')
    AND send_started_at IS NULL
    AND attempts < 5
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Dispatch attempt cannot start.' USING ERRCODE = '55000';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_alert_dispatch_attempt_v18(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_alert_dispatch_attempt_v18(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_ambiguous_alert_dispatches_v18()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH terminal AS (
    UPDATE public.alert_dispatches
    SET status = 'failed',
        attempts = attempts + 1,
        last_error = 'AMBIGUOUS_PROVIDER_RESULT: worker stopped after the durable send boundary; not retried to prevent a duplicate.',
        next_attempt_at = NULL,
        updated_at = now()
    WHERE status IN ('pending', 'failed')
      AND send_started_at IS NOT NULL
      AND send_started_at <= now() - interval '5 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM terminal;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ambiguous_alert_dispatches_v18() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_ambiguous_alert_dispatches_v18() TO service_role;

-- Record one send outcome. Failed attempts back off from 30 seconds to one hour;
-- the fifth failure is terminal (failed + no next_attempt_at) and is visible in
-- Owner Away. delivered_at is only stamped after a provider-confirmed send.
CREATE OR REPLACE FUNCTION public.record_alert_dispatch_result_v18(
  p_dispatch_id uuid,
  p_status text,
  p_last_error text DEFAULT NULL,
  p_provider_response text DEFAULT NULL,
  p_retryable boolean DEFAULT true,
  p_ambiguous boolean DEFAULT false
)
RETURNS public.alert_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.alert_dispatches%ROWTYPE;
  v_attempts integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid dispatch result.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.alert_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Dispatch not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IN ('sent', 'skipped') THEN
    RETURN v_row;
  END IF;

  v_attempts := v_row.attempts + 1;

  UPDATE public.alert_dispatches
  SET status = p_status,
      attempts = v_attempts,
      last_error = nullif(btrim(coalesce(p_last_error, '')), ''),
      provider_response = nullif(btrim(coalesce(p_provider_response, '')), ''),
      next_attempt_at = CASE
        WHEN p_status IN ('sent', 'skipped') THEN NULL
        WHEN p_ambiguous OR NOT p_retryable OR v_attempts >= 5 THEN NULL
        ELSE now() + make_interval(secs => least(3600, (30 * power(2, v_attempts - 1))::integer))
      END,
      send_started_at = CASE
        WHEN p_status = 'failed' AND p_retryable AND NOT p_ambiguous AND v_attempts < 5 THEN NULL
        ELSE send_started_at
      END,
      updated_at = now()
  WHERE id = p_dispatch_id
  RETURNING * INTO v_row;

  IF p_status = 'sent' AND v_row.alert_id IS NOT NULL THEN
    UPDATE public.owner_alerts
    SET delivered_at = coalesce(delivered_at, now())
    WHERE id = v_row.alert_id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_alert_dispatch_result_v18(uuid, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_alert_dispatch_result_v18(uuid, text, text, text, boolean, boolean) TO service_role;

-- One scheduled digest per branch/business-day. Immediate Owner Away digests
-- pass a separate, stable key for that toggle event.
CREATE OR REPLACE FUNCTION public.enqueue_owner_digest_dispatch_v18(
  p_branch_id uuid,
  p_business_date date,
  p_target text,
  p_payload jsonb,
  p_provider_idempotency_key text DEFAULT NULL
)
RETURNS public.alert_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.alert_dispatches%ROWTYPE;
  v_key text := coalesce(
    nullif(btrim(coalesce(p_provider_idempotency_key, '')), ''),
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
    branch_id, alert_id, kind, channel, target, status,
    provider_idempotency_key, payload, next_attempt_at
  )
  VALUES (
    p_branch_id, NULL, 'daily_digest', 'twilio_whatsapp',
    coalesce(p_target, ''), 'pending', v_key, p_payload, now()
  )
  ON CONFLICT (provider_idempotency_key) DO UPDATE
    SET provider_idempotency_key = excluded.provider_idempotency_key
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_owner_digest_dispatch_v18(uuid, date, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_owner_digest_dispatch_v18(uuid, date, text, jsonb, text) TO service_role;

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
  WHERE provider_idempotency_key = v_key;

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

-- Aggregate truth for Owner Away. Preview rows remain bounded in the app, but
-- counts and sums never derive from those caps.
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

-- One database snapshot for the scheduled digest. Every day filter is branch
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
