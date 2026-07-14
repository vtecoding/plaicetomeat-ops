-- V18 A1 — Payment truth (audit finding PTM-OPS-001).
--
-- Money facts become first-class append-only events. Before this migration the
-- system recorded that an order was collected but not that money changed hands:
-- orders.payment_method was a label on the order row, closing "count the till"
-- had nothing to count against, and a card sale and a cash sale were
-- indistinguishable in any day report. This migration ships:
--
--   1. branches.timezone made NOT NULL + branch_business_date() — every money
--      fact is stamped with the branch-local trading day at write time, so day
--      reports never window on naive UTC (a 23:50 sale and a 00:10 refund land
--      on their correct respective local days, DST-correct via the IANA zone).
--   2. payment_events — append-only sale/refund tender ledger (order-linked).
--   3. till_events — append-only drawer movements outside sales/refunds
--      (change added, supplier paid, owner withdrawal, cash drop), signed,
--      sign-enforced per kind.
--   4. collect_order_with_tender() — the ONLY path that collects an online
--      order from A1 on: one transaction that locks the order row, performs
--      ready→collected through the existing state machine (depletion stays
--      coupled exactly as today), derives the amount server-side from the
--      order's subtotal and inserts the sale payment event. If the tender
--      insert fails, the whole transaction rolls back — a collected-without-
--      tender row is impossible on this path.
--   5. record_till_event() — drawer movement writer, retry-safe by key.
--
-- Programme contract (docs/v18/00-implementation-plan.md §3-A1): exactly two
-- ORDER-payment RPCs will ever exist — this collection RPC and B3's
-- refund_order_v18. There is deliberately no generic tender RPC.

-- 1. Branch timezone is authoritative for business dates -----------------------
UPDATE public.branches SET timezone = 'Europe/London' WHERE timezone IS NULL;
ALTER TABLE public.branches
  ALTER COLUMN timezone SET DEFAULT 'Europe/London',
  ALTER COLUMN timezone SET NOT NULL;

-- Till variance alert threshold (decision D-2; default £5). Config, not design.
ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS till_variance_alert_pence integer NOT NULL DEFAULT 500;

CREATE OR REPLACE FUNCTION public.branch_business_date(
  p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (p_at AT TIME ZONE coalesce(
    (SELECT b.timezone FROM public.branches b WHERE b.id = p_branch_id),
    'Europe/London'
  ))::date;
$$;

GRANT EXECUTE ON FUNCTION public.branch_business_date(uuid, timestamptz)
  TO authenticated, service_role;

-- 2. payment_events — order-linked tender ledger --------------------------------
CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately NO ON DELETE CASCADE: money history must never vanish because
  -- a parent row was deleted. An order that took money cannot be deleted.
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  direction text NOT NULL CHECK (direction IN ('sale', 'refund')),
  method text NOT NULL CHECK (method IN ('cash', 'card')),
  amount_pence integer NOT NULL CHECK (amount_pence > 0),
  actor_id uuid REFERENCES public.profiles(id),
  reason text,
  business_date date NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_events IS
  'V18 A1: append-only money-of-record for order tenders (sale) and refunds. business_date is the branch-local trading day stamped at write time; all day reports window on it, never on created_at UTC.';

CREATE INDEX IF NOT EXISTS payment_events_branch_day_idx
  ON public.payment_events (branch_id, business_date);
CREATE INDEX IF NOT EXISTS payment_events_order_idx
  ON public.payment_events (order_id);

-- 3. till_events — drawer cash movements outside sales/refunds ------------------
CREATE TABLE IF NOT EXISTS public.till_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately NO ON DELETE CASCADE (money history outlives its parents).
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  kind text NOT NULL CHECK (kind IN ('paid_in', 'paid_out', 'cash_drop', 'correction')),
  signed_amount_pence integer NOT NULL CHECK (signed_amount_pence <> 0),
  reason_code text NOT NULL CHECK (reason_code IN ('change', 'supplier', 'owner', 'other')),
  note text,
  actor_id uuid REFERENCES public.profiles(id),
  business_date date NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Sign is enforced per kind: money in is positive, money out is negative,
  -- corrections are explicitly signed either way.
  CONSTRAINT till_events_sign_per_kind CHECK (
    (kind = 'paid_in' AND signed_amount_pence > 0)
    OR (kind IN ('paid_out', 'cash_drop') AND signed_amount_pence < 0)
    OR (kind = 'correction')
  )
);

COMMENT ON TABLE public.till_events IS
  'V18 A1: append-only drawer cash movements (change added, supplier paid, owner took cash, cash drop). Part of the expected-cash equation: expected = float + cash sales - cash refunds + sum(signed till events).';

CREATE INDEX IF NOT EXISTS till_events_branch_day_idx
  ON public.till_events (branch_id, business_date);

-- 4. Lock both tables: staff-read, RPC-only writes, append-only -----------------
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.till_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can read payment events" ON public.payment_events;
CREATE POLICY "staff can read payment events" ON public.payment_events
FOR SELECT USING (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "staff can read till events" ON public.till_events;
CREATE POLICY "staff can read till events" ON public.till_events
FOR SELECT USING (public.is_branch_staff(branch_id));

REVOKE ALL ON public.payment_events FROM anon;
REVOKE ALL ON public.till_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payment_events FROM authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.till_events FROM authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.prevent_money_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Money events are append-only; write a compensating event instead'
    USING ERRCODE = '25006';
END;
$$;

DROP TRIGGER IF EXISTS payment_events_append_only_row ON public.payment_events;
CREATE TRIGGER payment_events_append_only_row
BEFORE UPDATE OR DELETE ON public.payment_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_money_event_mutation();

DROP TRIGGER IF EXISTS payment_events_append_only_truncate ON public.payment_events;
CREATE TRIGGER payment_events_append_only_truncate
BEFORE TRUNCATE ON public.payment_events
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_money_event_mutation();

DROP TRIGGER IF EXISTS till_events_append_only_row ON public.till_events;
CREATE TRIGGER till_events_append_only_row
BEFORE UPDATE OR DELETE ON public.till_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_money_event_mutation();

DROP TRIGGER IF EXISTS till_events_append_only_truncate ON public.till_events;
CREATE TRIGGER till_events_append_only_truncate
BEFORE TRUNCATE ON public.till_events
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_money_event_mutation();

-- 5. collect_order_with_tender — collection and tender are one transaction ------
CREATE OR REPLACE FUNCTION public.collect_order_with_tender(
  p_order_id uuid,
  p_method text,
  p_idempotency_key text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_existing public.payment_events%ROWTYPE;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_amount integer;
  v_business_date date;
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF p_method NOT IN ('cash', 'card') THEN
    RAISE EXCEPTION 'Unknown payment method: %', p_method USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Missing tender idempotency key.' USING ERRCODE = '22023';
  END IF;

  -- The serialisation point every order-money RPC shares (plan rule 1.2):
  -- tender, refund (B3), amendment (B4) and depletion can never interleave.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  -- Idempotent replay: the same key returns the original outcome, writes nothing.
  SELECT * INTO v_existing FROM public.payment_events WHERE idempotency_key = v_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.order_id <> p_order_id THEN
      RAISE EXCEPTION 'Tender key already used for another order.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'payment_event_id', v_existing.id,
      'order_id', v_existing.order_id,
      'method', v_existing.method,
      'amount_pence', v_existing.amount_pence,
      'business_date', v_existing.business_date,
      'replayed', true
    );
  END IF;

  -- A concurrent second caller (different key) lands here after the first
  -- committed and gets a clean "already collected" with no second event.
  IF v_order.status = 'collected' THEN
    RAISE EXCEPTION 'Order already collected.' USING ERRCODE = '22023';
  END IF;
  IF v_order.status <> 'ready' THEN
    RAISE EXCEPTION 'Invalid transition from % to collected.', v_order.status USING ERRCODE = '22023';
  END IF;

  -- Amount is derived server-side, never client-supplied. B4 upgrades this to
  -- the frozen folded order version (body-only change, same name/signature).
  v_amount := round(v_order.subtotal * 100)::integer;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Order has no positive amount to tender.' USING ERRCODE = '22023';
  END IF;

  -- ready → collected through the existing state machine so depletion stays
  -- coupled exactly as today (same transaction; failure here aborts everything).
  PERFORM public.transition_order_status(p_order_id, 'collected', p_note);

  v_business_date := public.branch_business_date(v_order.branch_id, now());

  INSERT INTO public.payment_events(branch_id, order_id, direction, method, amount_pence, actor_id, business_date, idempotency_key)
  VALUES (v_order.branch_id, p_order_id, 'sale', p_method, v_amount, v_actor, v_business_date, v_key)
  RETURNING id INTO v_event_id;

  PERFORM public.emit_audit_log(
    'order_tender_recorded',
    'order',
    p_order_id,
    v_order.branch_id,
    jsonb_build_object(
      'method', p_method,
      'amount_pence', v_amount,
      'business_date', v_business_date,
      'order_ref', v_order.order_ref,
      'payment_event_id', v_event_id
    )
  );

  RETURN jsonb_build_object(
    'payment_event_id', v_event_id,
    'order_id', p_order_id,
    'method', p_method,
    'amount_pence', v_amount,
    'business_date', v_business_date,
    'replayed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.collect_order_with_tender(uuid, text, text, text)
  TO authenticated, service_role;

-- 6. record_till_event — drawer movements, retry-safe by key --------------------
CREATE OR REPLACE FUNCTION public.record_till_event(
  p_branch_id uuid,
  p_kind text,
  p_amount_pence integer,
  p_reason_code text,
  p_idempotency_key text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.till_events%ROWTYPE;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_business_date date;
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_staff(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('paid_in', 'paid_out', 'cash_drop', 'correction') THEN
    RAISE EXCEPTION 'Unknown till movement kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_reason_code NOT IN ('change', 'supplier', 'owner', 'other') THEN
    RAISE EXCEPTION 'Unknown till movement reason.' USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Missing till movement idempotency key.' USING ERRCODE = '22023';
  END IF;
  IF p_amount_pence IS NULL OR p_amount_pence = 0 THEN
    RAISE EXCEPTION 'Till movement amount cannot be zero.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'paid_in' AND p_amount_pence < 0 THEN
    RAISE EXCEPTION 'Money in must be a positive amount.' USING ERRCODE = '22023';
  END IF;
  IF p_kind IN ('paid_out', 'cash_drop') AND p_amount_pence > 0 THEN
    RAISE EXCEPTION 'Money out must be a negative amount.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.till_events WHERE idempotency_key = v_key;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'till_event_id', v_existing.id,
      'kind', v_existing.kind,
      'signed_amount_pence', v_existing.signed_amount_pence,
      'business_date', v_existing.business_date,
      'replayed', true
    );
  END IF;

  v_business_date := public.branch_business_date(p_branch_id, now());

  INSERT INTO public.till_events(branch_id, kind, signed_amount_pence, reason_code, note, actor_id, business_date, idempotency_key)
  VALUES (p_branch_id, p_kind, p_amount_pence, p_reason_code, nullif(btrim(coalesce(p_note, '')), ''), v_actor, v_business_date, v_key)
  RETURNING id INTO v_event_id;

  PERFORM public.emit_audit_log(
    'till_event_recorded',
    'till_event',
    v_event_id,
    p_branch_id,
    jsonb_build_object(
      'kind', p_kind,
      'signed_amount_pence', p_amount_pence,
      'reason_code', p_reason_code,
      'business_date', v_business_date
    )
  );

  RETURN jsonb_build_object(
    'till_event_id', v_event_id,
    'kind', p_kind,
    'signed_amount_pence', p_amount_pence,
    'business_date', v_business_date,
    'replayed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_till_event(uuid, text, integer, text, text, text)
  TO authenticated, service_role;
