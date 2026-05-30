ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS min_order_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS same_day_cutoff_time time NOT NULL DEFAULT '16:00',
  ADD COLUMN IF NOT EXISTS staff_session_timeout_minutes int NOT NULL DEFAULT 240;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'action'
  ) THEN
    ALTER TABLE public.audit_logs RENAME COLUMN action TO event_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE public.audit_logs RENAME COLUMN entity_type TO target_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE public.audit_logs RENAME COLUMN entity_id TO target_id;
  END IF;
END $$;

ALTER TABLE public.audit_logs
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_created ON public.audit_logs(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_annual_sequences (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_year int NOT NULL,
  last_sequence int NOT NULL DEFAULT 0,
  PRIMARY KEY(branch_id, order_year)
);

ALTER TABLE public.order_annual_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners can read order annual sequences" ON public.order_annual_sequences;
CREATE POLICY "owners can read order annual sequences" ON public.order_annual_sequences
FOR SELECT USING (public.current_profile_role() = 'owner');

CREATE OR REPLACE FUNCTION public.next_order_ref(target_branch_id uuid, target_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_sequence int;
  target_year int := extract(year from target_date)::int;
BEGIN
  INSERT INTO public.order_annual_sequences(branch_id, order_year, last_sequence)
  VALUES (target_branch_id, target_year, 1)
  ON CONFLICT (branch_id, order_year)
  DO UPDATE SET last_sequence = public.order_annual_sequences.last_sequence + 1
  RETURNING last_sequence INTO next_sequence;

  RETURN 'PTM-' || target_year::text || '-' || lpad(next_sequence::text, 5, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('incoming', 'prepping', 'ready', 'collected', 'cancelled')),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (char_length(note) <= 1000),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id, template_key)
);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address inet,
  success boolean NOT NULL DEFAULT false,
  locked_until timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  address text,
  halal_certifying_body text,
  cert_number text,
  cert_expiry date,
  payment_terms text,
  preferred boolean DEFAULT false,
  reliability_score numeric(3,1),
  active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('halal_cert', 'health_cert', 'insurance', 'lab_test', 'invoice', 'other')),
  issued_date date,
  expiry_date date,
  document_url text NOT NULL,
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  received_date date NOT NULL,
  expiry_date date NOT NULL,
  received_weight_kg numeric(8,3) NOT NULL CHECK (received_weight_kg >= 0),
  remaining_weight_kg numeric(8,3) NOT NULL CHECK (remaining_weight_kg >= 0),
  invoice_cost numeric(8,2),
  cost_per_kg numeric(8,2),
  halal_cert_ref text,
  country_of_origin text,
  slaughter_date date,
  storage_location text,
  batch_number text,
  status text NOT NULL CHECK (status IN ('active', 'depleted', 'disposed', 'recalled')) DEFAULT 'active',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('RECEIVED', 'SALE', 'WASTE', 'TRANSFER', 'ADJUSTMENT')),
  quantity_kg numeric(8,3) NOT NULL CHECK (quantity_kg > 0),
  reference_id uuid,
  reason text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE VIEW public.stock_levels
WITH (security_invoker = true)
AS
SELECT
  product_id,
  branch_id,
  sum(remaining_weight_kg)::numeric(8,3) AS total_kg,
  count(*)::int AS batches_count,
  min(expiry_date) AS earliest_expiry,
  max(updated_at) AS updated_at
FROM public.inventory_batches
WHERE status = 'active'
GROUP BY product_id, branch_id;

CREATE INDEX IF NOT EXISTS idx_order_status_events_order_created ON public.order_status_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_notes_order_created ON public.order_notes(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_templates_branch_key ON public.sms_templates(branch_id, template_key);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_created ON public.login_attempts(lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suppliers_branch_active ON public.suppliers(branch_id, active);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_expiry ON public.supplier_documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_branch_expiry ON public.inventory_batches(branch_id, expiry_date, status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_batch_created ON public.inventory_movements(batch_id, created_at DESC);

ALTER TABLE public.order_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can read branch order status events" ON public.order_status_events;
CREATE POLICY "staff can read branch order status events" ON public.order_status_events
FOR SELECT USING (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "staff can create branch order status events" ON public.order_status_events;
CREATE POLICY "staff can create branch order status events" ON public.order_status_events
FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "staff can read branch order notes" ON public.order_notes;
CREATE POLICY "staff can read branch order notes" ON public.order_notes
FOR SELECT USING (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "staff can create branch order notes" ON public.order_notes;
CREATE POLICY "staff can create branch order notes" ON public.order_notes
FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "managers can manage sms templates" ON public.sms_templates;
CREATE POLICY "managers can manage sms templates" ON public.sms_templates
FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));

DROP POLICY IF EXISTS "managers can manage suppliers" ON public.suppliers;
CREATE POLICY "managers can manage suppliers" ON public.suppliers
FOR ALL USING (branch_id IS NULL OR public.is_branch_manager(branch_id)) WITH CHECK (branch_id IS NULL OR public.is_branch_manager(branch_id));

DROP POLICY IF EXISTS "staff can read suppliers" ON public.suppliers;
CREATE POLICY "staff can read suppliers" ON public.suppliers
FOR SELECT USING (branch_id IS NULL OR public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "managers can manage supplier documents" ON public.supplier_documents;
CREATE POLICY "managers can manage supplier documents" ON public.supplier_documents
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = supplier_id AND (s.branch_id IS NULL OR public.is_branch_manager(s.branch_id))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = supplier_id AND (s.branch_id IS NULL OR public.is_branch_manager(s.branch_id))
  )
);

DROP POLICY IF EXISTS "staff can read supplier documents" ON public.supplier_documents;
CREATE POLICY "staff can read supplier documents" ON public.supplier_documents
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = supplier_id AND (s.branch_id IS NULL OR public.is_branch_staff(s.branch_id))
  )
);

DROP POLICY IF EXISTS "staff can read inventory batches" ON public.inventory_batches;
CREATE POLICY "staff can read inventory batches" ON public.inventory_batches
FOR SELECT USING (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "managers can manage inventory batches" ON public.inventory_batches;
CREATE POLICY "managers can manage inventory batches" ON public.inventory_batches
FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));

DROP POLICY IF EXISTS "staff can read inventory movements" ON public.inventory_movements;
CREATE POLICY "staff can read inventory movements" ON public.inventory_movements
FOR SELECT USING (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "staff can create inventory movements" ON public.inventory_movements;
CREATE POLICY "staff can create inventory movements" ON public.inventory_movements
FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));

CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_pickup_date date,
  p_pickup_window_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_items jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_ref text;
  v_order_id uuid;
  v_order_ref text;
  v_subtotal numeric(10,2);
  v_min_order_value numeric(10,2);
  v_same_day_cutoff time;
  v_window public.pickup_windows%ROWTYPE;
  v_branch_timezone text;
  v_now_local timestamp;
  v_today_local date;
  v_order_count int;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Basket cannot be empty.';
  END IF;

  SELECT order_ref INTO v_existing_ref
  FROM public.orders
  WHERE idempotency_key = p_idempotency_key;

  IF v_existing_ref IS NOT NULL THEN
    RETURN v_existing_ref;
  END IF;

  SELECT timezone INTO v_branch_timezone
  FROM public.branches
  WHERE id = p_branch_id AND is_active = true;

  IF v_branch_timezone IS NULL THEN
    RAISE EXCEPTION 'Branch is not available.';
  END IF;

  SELECT * INTO v_window
  FROM public.pickup_windows
  WHERE id = p_pickup_window_id
    AND branch_id = p_branch_id
    AND is_active = true;

  IF v_window.id IS NULL THEN
    RAISE EXCEPTION 'Pickup window is not available.';
  END IF;

  SELECT
    coalesce(min_order_value, 0),
    coalesce(same_day_cutoff_time, '16:00'::time)
  INTO v_min_order_value, v_same_day_cutoff
  FROM public.branch_settings
  WHERE branch_id = p_branch_id;

  v_min_order_value := coalesce(v_min_order_value, 0);
  v_same_day_cutoff := coalesce(v_same_day_cutoff, '16:00'::time);
  v_now_local := now() AT TIME ZONE v_branch_timezone;
  v_today_local := v_now_local::date;

  IF p_pickup_date < v_today_local THEN
    RAISE EXCEPTION 'Pickup date cannot be in the past.';
  END IF;

  IF p_pickup_date = v_today_local AND v_now_local::time >= v_same_day_cutoff THEN
    RAISE EXCEPTION 'Same-day orders close at 4pm.';
  END IF;

  IF NOT (extract(isodow from p_pickup_date)::int = ANY(v_window.days_of_week)) THEN
    RAISE EXCEPTION 'Pickup window is not available on this date.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shop_closures
    WHERE branch_id = p_branch_id AND close_date = p_pickup_date
  ) THEN
    RAISE EXCEPTION 'The shop is closed on this pickup date.';
  END IF;

  IF v_window.max_orders IS NOT NULL THEN
    SELECT count(*) INTO v_order_count
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND pickup_date = p_pickup_date
      AND pickup_window_id = p_pickup_window_id
      AND status <> 'cancelled';

    IF v_order_count >= v_window.max_orders THEN
      RAISE EXCEPTION 'This pickup window is full.';
    END IF;
  END IF;

  WITH requested AS (
    SELECT
      (item->>'productId')::uuid AS product_id,
      (item->>'quantity')::numeric AS quantity
    FROM jsonb_array_elements(p_items) AS item
  )
  SELECT sum(round(requested.quantity * products.price_per_unit, 2))::numeric(10,2)
  INTO v_subtotal
  FROM requested
  JOIN public.products products
    ON products.id = requested.product_id
   AND products.branch_id = p_branch_id
  WHERE products.is_available = true
    AND products.stock_status <> 'out_of_stock'
    AND requested.quantity >= products.min_order_quantity
    AND requested.quantity <= coalesce(products.max_order_quantity, 20);

  IF v_subtotal IS NULL THEN
    RAISE EXCEPTION 'One or more basket items are no longer available.';
  END IF;

  IF EXISTS (
    WITH requested AS (
      SELECT
        (item->>'productId')::uuid AS product_id,
        (item->>'quantity')::numeric AS quantity
      FROM jsonb_array_elements(p_items) AS item
    )
    SELECT 1
    FROM requested
    LEFT JOIN public.products products
      ON products.id = requested.product_id
     AND products.branch_id = p_branch_id
    WHERE products.id IS NULL
       OR products.is_available = false
       OR products.stock_status = 'out_of_stock'
       OR requested.quantity < products.min_order_quantity
       OR requested.quantity > coalesce(products.max_order_quantity, 20)
  ) THEN
    RAISE EXCEPTION 'One or more basket items are no longer available.';
  END IF;

  IF v_subtotal < v_min_order_value THEN
    RAISE EXCEPTION 'Minimum order is GBP %.', v_min_order_value;
  END IF;

  v_order_ref := public.next_order_ref(p_branch_id, p_pickup_date);

  INSERT INTO public.orders (
    branch_id,
    order_ref,
    customer_name,
    customer_phone,
    customer_email,
    pickup_window_id,
    pickup_date,
    subtotal,
    notes,
    idempotency_key
  )
  VALUES (
    p_branch_id,
    v_order_ref,
    btrim(p_customer_name),
    p_customer_phone,
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_pickup_window_id,
    p_pickup_date,
    v_subtotal,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key
  )
  RETURNING id INTO v_order_id;

  WITH requested AS (
    SELECT
      (item->>'productId')::uuid AS product_id,
      (item->>'quantity')::numeric AS quantity
    FROM jsonb_array_elements(p_items) AS item
  )
  INSERT INTO public.order_items (
    branch_id,
    order_id,
    product_id,
    product_name_snapshot,
    quantity,
    unit_type,
    unit_price_snapshot,
    line_total
  )
  SELECT
    p_branch_id,
    v_order_id,
    products.id,
    products.name,
    requested.quantity,
    products.unit_type,
    products.price_per_unit,
    round(requested.quantity * products.price_per_unit, 2)
  FROM requested
  JOIN public.products products
    ON products.id = requested.product_id
   AND products.branch_id = p_branch_id;

  INSERT INTO public.order_status_events(branch_id, order_id, status, note)
  VALUES (p_branch_id, v_order_id, 'incoming', 'Order received from checkout.');

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, metadata)
  VALUES (
    'order_created',
    'order',
    v_order_id,
    p_branch_id,
    jsonb_build_object('order_ref', v_order_ref, 'subtotal', v_subtotal)
  );

  RETURN v_order_ref;
EXCEPTION
  WHEN unique_violation THEN
    SELECT order_ref INTO v_existing_ref
    FROM public.orders
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_ref IS NOT NULL THEN
      RETURN v_existing_ref;
    END IF;

    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_order_ref(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(
  uuid,
  text,
  text,
  text,
  date,
  uuid,
  text,
  text,
  jsonb
) TO anon, authenticated, service_role;
