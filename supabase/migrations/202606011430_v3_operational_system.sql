-- V3 operational system hardening.
-- Adds an immutable audit_events surface, explicit waste events, settings RPC,
-- inventory adjustment RPC, and stricter audited operational writes.

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email text,
  actor_role text,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  ip_address inet,
  user_agent text
);

CREATE OR REPLACE FUNCTION public.prevent_audit_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON public.audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_events_mutation();

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON public.audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_created ON public.audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON public.audit_events(entity_type, entity_id);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can read own branch audit events" ON public.audit_events;
CREATE POLICY "staff can read own branch audit events" ON public.audit_events
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.audit_logs l
    WHERE l.target_id = audit_events.entity_id
      AND l.event_type = audit_events.event_type
      AND public.is_branch_staff(l.branch_id)
  )
  OR public.current_profile_role() = 'owner'
);

DROP POLICY IF EXISTS "authenticated can create audit events" ON public.audit_events;
CREATE POLICY "authenticated can create audit events" ON public.audit_events
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.mirror_audit_log_to_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_summary text;
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.actor_id;
  END IF;

  v_summary := replace(coalesce(NEW.event_type, 'event'), '_', ' ');

  INSERT INTO public.audit_events (
    actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, metadata
  )
  VALUES (
    NEW.actor_id,
    v_profile.email,
    v_profile.role,
    NEW.event_type,
    NEW.target_type,
    NEW.target_id,
    v_summary,
    coalesce(NEW.metadata, '{}')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_mirror_to_events ON public.audit_logs;
CREATE TRIGGER audit_logs_mirror_to_events
AFTER INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.mirror_audit_log_to_event();

INSERT INTO public.audit_events (actor_user_id, event_type, entity_type, entity_id, summary, metadata, created_at)
SELECT actor_id, event_type, target_type, target_id, replace(event_type, '_', ' '), coalesce(metadata, '{}'), created_at
FROM public.audit_logs l
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_events e
  WHERE e.event_type = l.event_type
    AND e.entity_type = l.target_type
    AND e.entity_id IS NOT DISTINCT FROM l.target_id
    AND e.created_at = l.created_at
);

CREATE TABLE IF NOT EXISTS public.inventory_waste_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  waste_kg numeric(8,3) NOT NULL CHECK (waste_kg > 0),
  reason text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_waste_events_batch_created ON public.inventory_waste_events(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_waste_events_product_created ON public.inventory_waste_events(product_id, created_at DESC);

ALTER TABLE public.inventory_waste_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can read branch waste events" ON public.inventory_waste_events;
CREATE POLICY "staff can read branch waste events" ON public.inventory_waste_events
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.inventory_batches b
    WHERE b.id = batch_id AND public.is_branch_staff(b.branch_id)
  )
);

DROP POLICY IF EXISTS "managers can create branch waste events" ON public.inventory_waste_events;
CREATE POLICY "managers can create branch waste events" ON public.inventory_waste_events
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.inventory_batches b
    WHERE b.id = batch_id AND public.is_branch_manager(b.branch_id)
  )
);

ALTER TABLE public.inventory_batches
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_batch_number text,
  ADD COLUMN IF NOT EXISTS manual_adjustment_reason text;

UPDATE public.inventory_batches
SET supplier_batch_number = batch_number
WHERE supplier_batch_number IS NULL AND batch_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiring_active
ON public.inventory_batches(branch_id, expiry_date)
WHERE status = 'active' AND remaining_weight_kg > 0;

CREATE INDEX IF NOT EXISTS idx_supplier_documents_verified_expiry
ON public.supplier_documents(verified_at, expiry_date);

CREATE OR REPLACE FUNCTION public.admin_record_inventory_waste(
  p_batch_id uuid,
  p_quantity_kg numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.inventory_batches%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_waste_id uuid;
  v_new_remaining numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_batch.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_quantity_kg IS NULL OR p_quantity_kg <= 0 THEN
    RAISE EXCEPTION 'Waste quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF p_quantity_kg > v_batch.remaining_weight_kg THEN
    RAISE EXCEPTION 'Waste quantity cannot exceed remaining weight.' USING ERRCODE = '22023';
  END IF;

  IF v_reason NOT IN ('expired', 'damaged', 'trim_loss', 'customer_issue', 'contaminated', 'customer_return', 'other', 'review') THEN
    RAISE EXCEPTION 'Waste reason is required.' USING ERRCODE = '22023';
  END IF;

  v_new_remaining := v_batch.remaining_weight_kg - p_quantity_kg;

  UPDATE public.inventory_batches
  SET remaining_weight_kg = v_new_remaining,
      status = CASE WHEN v_new_remaining = 0 THEN 'disposed' ELSE status END
  WHERE id = p_batch_id;

  INSERT INTO public.inventory_waste_events(batch_id, product_id, waste_kg, reason, created_by)
  VALUES (p_batch_id, v_batch.product_id, p_quantity_kg, v_reason, v_actor)
  RETURNING id INTO v_waste_id;

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by, reference_id)
  VALUES (p_batch_id, v_batch.branch_id, 'WASTE', p_quantity_kg, v_reason, v_actor, v_waste_id);

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'waste_recorded', 'inventory_batch', p_batch_id, v_batch.branch_id, v_actor,
    jsonb_build_object(
      'waste_event_id', v_waste_id,
      'quantity_kg', p_quantity_kg,
      'reason', v_reason,
      'remaining_kg', v_new_remaining,
      'estimated_loss', round(p_quantity_kg * coalesce(v_batch.cost_per_kg, 0), 2)
    )
  );

  RETURN v_waste_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_inventory_remaining(
  p_batch_id uuid,
  p_new_remaining_kg numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.inventory_batches%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_delta numeric;
  v_movement_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_batch.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_new_remaining_kg IS NULL OR p_new_remaining_kg < 0 OR p_new_remaining_kg > v_batch.received_weight_kg THEN
    RAISE EXCEPTION 'Remaining weight cannot exceed received weight.' USING ERRCODE = '22023';
  END IF;

  IF length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Adjustment reason is required.' USING ERRCODE = '22023';
  END IF;

  v_delta := p_new_remaining_kg - v_batch.remaining_weight_kg;

  UPDATE public.inventory_batches
  SET remaining_weight_kg = p_new_remaining_kg,
      manual_adjustment_reason = v_reason,
      status = CASE WHEN p_new_remaining_kg = 0 THEN 'depleted' ELSE 'active' END
  WHERE id = p_batch_id;

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by)
  VALUES (p_batch_id, v_batch.branch_id, 'ADJUSTMENT', abs(v_delta), v_reason, v_actor)
  RETURNING id INTO v_movement_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'inventory_remaining_adjusted', 'inventory_batch', p_batch_id, v_batch.branch_id, v_actor,
    jsonb_build_object('from_kg', v_batch.remaining_weight_kg, 'to_kg', p_new_remaining_kg, 'reason', v_reason)
  );

  RETURN v_movement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_branch_settings(
  p_branch_id uuid,
  p_address text,
  p_sms_ready_template text,
  p_cancellation_window_minutes int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_address text := btrim(coalesce(p_address, ''));
  v_template text := btrim(coalesce(p_sms_ready_template, ''));
  v_bad_placeholder text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_address) = 0 THEN
    RAISE EXCEPTION 'Branch address is required.' USING ERRCODE = '22023';
  END IF;

  IF length(v_template) = 0 THEN
    RAISE EXCEPTION 'SMS template is required.' USING ERRCODE = '22023';
  END IF;

  SELECT m.parts[1] INTO v_bad_placeholder
  FROM regexp_matches(v_template, '\{([^{}]+)\}', 'g') AS m(parts)
  WHERE m.parts[1] NOT IN ('order_ref', 'address')
  LIMIT 1;

  IF v_bad_placeholder IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported SMS placeholder: {%}.', v_bad_placeholder USING ERRCODE = '22023';
  END IF;

  IF p_cancellation_window_minutes IS NULL OR p_cancellation_window_minutes < 0 THEN
    RAISE EXCEPTION 'Cancellation window must be zero minutes or greater.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.branches SET address = v_address WHERE id = p_branch_id;

  INSERT INTO public.branch_settings(branch_id, sms_ready_template, cancellation_window_minutes)
  VALUES (p_branch_id, v_template, p_cancellation_window_minutes)
  ON CONFLICT (branch_id)
  DO UPDATE SET
    sms_ready_template = excluded.sms_ready_template,
    cancellation_window_minutes = excluded.cancellation_window_minutes;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'branch_settings_updated', 'branch_settings', p_branch_id, p_branch_id, v_actor,
    jsonb_build_object('address_changed', true, 'sms_template_updated', true)
  );

  RETURN p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_inventory_waste(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory_remaining(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_branch_settings(uuid, text, text, int) TO authenticated;
