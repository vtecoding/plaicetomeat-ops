CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  address text NOT NULL,
  phone text,
  timezone text DEFAULT 'Europe/London',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.branch_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  sms_ready_template text NOT NULL DEFAULT 'Your PlaiceToMeat order {order_ref} is ready at {address}. Please collect during your pickup window. Reply HERE when you arrive.',
  cancellation_window_minutes int NOT NULL DEFAULT 60,
  max_orders_per_day int,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id)
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  email text NOT NULL,
  full_name text,
  role text CHECK (role IN ('staff', 'manager', 'owner')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id, slug)
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.product_categories(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  unit_type text CHECK (unit_type IN ('kg', 'each', 'box')),
  price_per_unit numeric(10,2) NOT NULL,
  min_order_quantity numeric(10,3) DEFAULT 0.5,
  max_order_quantity numeric(10,3),
  image_url text,
  is_available boolean DEFAULT true,
  stock_status text CHECK (stock_status IN ('in_stock', 'low_stock', 'out_of_stock')) DEFAULT 'in_stock',
  requires_weight_confirmation boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id, slug)
);

CREATE TABLE public.pickup_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  label text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  cutoff_time time,
  max_orders int,
  days_of_week int[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  window_type text CHECK (window_type IN ('standard', 'commuter', 'weekend')) DEFAULT 'standard',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.shop_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  close_date date NOT NULL,
  reason text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id, close_date)
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_ref text UNIQUE NOT NULL,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  status text CHECK (status IN ('incoming', 'prepping', 'ready', 'collected', 'cancelled')) DEFAULT 'incoming',
  pickup_window_id uuid REFERENCES public.pickup_windows(id),
  pickup_date date NOT NULL,
  subtotal numeric(10,2) NOT NULL,
  payment_method text CHECK (payment_method IN ('cash', 'card', 'online')) DEFAULT NULL,
  notes text,
  cancellation_reason text,
  cancelled_by text CHECK (cancelled_by IN ('customer', 'staff', 'system')),
  ready_sms_sent_at timestamptz,
  idempotency_key text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  product_name_snapshot text NOT NULL,
  quantity numeric(10,3) NOT NULL,
  unit_type text NOT NULL,
  unit_price_snapshot numeric(10,2) NOT NULL,
  line_total numeric(10,2) NOT NULL,
  staff_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.compliance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  opened_by uuid NOT NULL REFERENCES public.profiles(id),
  closed_by uuid REFERENCES public.profiles(id),
  cleaning_completed boolean DEFAULT false,
  sanitisation_completed boolean DEFAULT false,
  waste_checked boolean DEFAULT false,
  notes text,
  status text CHECK (status IN ('open', 'completed')) DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(branch_id, log_date)
);

CREATE TABLE public.compliance_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  compliance_log_id uuid NOT NULL REFERENCES public.compliance_logs(id) ON DELETE CASCADE,
  reading_type text CHECK (reading_type IN ('opening', 'midday', 'closing', 'ad_hoc')) NOT NULL,
  chiller_temp_c numeric(4,1) NOT NULL,
  freezer_temp_c numeric(4,1) NOT NULL,
  display_temp_c numeric(4,1),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.order_daily_sequences (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_date date NOT NULL,
  last_sequence int NOT NULL DEFAULT 0,
  PRIMARY KEY(branch_id, order_date)
);

CREATE OR REPLACE FUNCTION public.next_order_ref(target_branch_id uuid, target_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_sequence int;
BEGIN
  INSERT INTO public.order_daily_sequences(branch_id, order_date, last_sequence)
  VALUES (target_branch_id, target_date, 1)
  ON CONFLICT (branch_id, order_date)
  DO UPDATE SET last_sequence = public.order_daily_sequences.last_sequence + 1
  RETURNING last_sequence INTO next_sequence;

  RETURN 'PTM-' || to_char(target_date, 'YYMMDD') || '-' || lpad(next_sequence::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.current_profile_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_branch_staff(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.role IN ('staff', 'manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = target_branch_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_branch_manager(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.role IN ('manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = target_branch_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_public_order(target_order_ref text)
RETURNS TABLE (
  order_ref text,
  customer_name text,
  status text,
  pickup_date date,
  pickup_window_label text,
  pickup_window_start time,
  pickup_window_end time,
  subtotal numeric,
  ready_sms_sent_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.order_ref,
    o.customer_name,
    o.status,
    o.pickup_date,
    pw.label,
    pw.start_time,
    pw.end_time,
    o.subtotal,
    o.ready_sms_sent_at,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.pickup_windows pw ON pw.id = o.pickup_window_id
  WHERE o.order_ref = target_order_ref
  LIMIT 1;
$$;

CREATE INDEX idx_profiles_branch ON public.profiles(branch_id);
CREATE INDEX idx_product_categories_branch_sort ON public.product_categories(branch_id, sort_order);
CREATE INDEX idx_products_branch_category_sort ON public.products(branch_id, category_id, sort_order);
CREATE INDEX idx_pickup_windows_branch_active ON public.pickup_windows(branch_id, is_active);
CREATE INDEX idx_shop_closures_branch_date ON public.shop_closures(branch_id, close_date);
CREATE INDEX idx_orders_branch_status ON public.orders(branch_id, status, pickup_date);
CREATE INDEX idx_orders_phone_created ON public.orders(branch_id, customer_phone, created_at);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_compliance_logs_branch_date ON public.compliance_logs(branch_id, log_date);
CREATE INDEX idx_compliance_readings_log ON public.compliance_readings(compliance_log_id, reading_type);
CREATE INDEX idx_audit_logs_branch_created ON public.audit_logs(branch_id, created_at DESC);

CREATE TRIGGER branches_set_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER branch_settings_set_updated_at BEFORE UPDATE ON public.branch_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER product_categories_set_updated_at BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pickup_windows_set_updated_at BEFORE UPDATE ON public.pickup_windows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER shop_closures_set_updated_at BEFORE UPDATE ON public.shop_closures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER order_items_set_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER compliance_logs_set_updated_at BEFORE UPDATE ON public.compliance_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_daily_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public can read active branches" ON public.branches FOR SELECT USING (is_active = true);
CREATE POLICY "owners can manage branches" ON public.branches FOR ALL USING (public.current_profile_role() = 'owner') WITH CHECK (public.current_profile_role() = 'owner');

CREATE POLICY "public can read active branch settings" ON public.branch_settings FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.branches b WHERE b.id = branch_id AND b.is_active = true)
);
CREATE POLICY "managers can manage own branch settings" ON public.branch_settings FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));

CREATE POLICY "users can read own profile" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "managers can read branch profiles" ON public.profiles FOR SELECT USING (public.is_branch_manager(branch_id));
CREATE POLICY "owners can manage profiles" ON public.profiles FOR ALL USING (public.current_profile_role() = 'owner') WITH CHECK (public.current_profile_role() = 'owner');

CREATE POLICY "public can read active categories" ON public.product_categories FOR SELECT USING (is_active = true);
CREATE POLICY "managers can manage categories" ON public.product_categories FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));

CREATE POLICY "public can read active products" ON public.products FOR SELECT USING (is_available = true);
CREATE POLICY "staff can read branch products" ON public.products FOR SELECT USING (public.is_branch_staff(branch_id));
CREATE POLICY "managers can manage products" ON public.products FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));

CREATE POLICY "public can read active pickup windows" ON public.pickup_windows FOR SELECT USING (is_active = true);
CREATE POLICY "managers can manage pickup windows" ON public.pickup_windows FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));

CREATE POLICY "public can read shop closures" ON public.shop_closures FOR SELECT USING (true);
CREATE POLICY "managers can manage shop closures" ON public.shop_closures FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));

CREATE POLICY "staff can read branch orders" ON public.orders FOR SELECT USING (public.is_branch_staff(branch_id));
CREATE POLICY "staff can update branch orders" ON public.orders FOR UPDATE USING (public.is_branch_staff(branch_id)) WITH CHECK (public.is_branch_staff(branch_id));

CREATE POLICY "staff can read branch order items" ON public.order_items FOR SELECT USING (public.is_branch_staff(branch_id));
CREATE POLICY "staff can update branch order items" ON public.order_items FOR UPDATE USING (public.is_branch_staff(branch_id)) WITH CHECK (public.is_branch_staff(branch_id));

CREATE POLICY "staff can read branch compliance logs" ON public.compliance_logs FOR SELECT USING (public.is_branch_staff(branch_id));
CREATE POLICY "staff can create branch compliance logs" ON public.compliance_logs FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));
CREATE POLICY "staff can update branch compliance logs" ON public.compliance_logs FOR UPDATE USING (public.is_branch_staff(branch_id)) WITH CHECK (public.is_branch_staff(branch_id));

CREATE POLICY "staff can read branch compliance readings" ON public.compliance_readings FOR SELECT USING (public.is_branch_staff(branch_id));
CREATE POLICY "staff can create branch compliance readings" ON public.compliance_readings FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));

CREATE POLICY "staff can read branch audit logs" ON public.audit_logs FOR SELECT USING (public.is_branch_staff(branch_id));
CREATE POLICY "authenticated can create audit logs" ON public.audit_logs FOR INSERT WITH CHECK (
  branch_id IS NULL OR public.is_branch_staff(branch_id)
);

CREATE POLICY "owners can read order daily sequences" ON public.order_daily_sequences FOR SELECT USING (public.current_profile_role() = 'owner');

GRANT EXECUTE ON FUNCTION public.next_order_ref(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_order(text) TO anon, authenticated;
