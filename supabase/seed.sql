INSERT INTO public.branches (id, name, slug, address, phone, timezone, is_active)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'PlaiceToMeat Wylde Green',
  'wylde-green',
  '426 Birmingham Road, Wylde Green',
  '+441213555426',
  'Europe/London',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  timezone = EXCLUDED.timezone,
  is_active = EXCLUDED.is_active;

INSERT INTO public.branch_settings (branch_id, min_order_value, same_day_cutoff_time)
VALUES ('00000000-0000-4000-8000-000000000001', 0, '16:00')
ON CONFLICT (branch_id) DO UPDATE SET
  min_order_value = EXCLUDED.min_order_value,
  same_day_cutoff_time = EXCLUDED.same_day_cutoff_time;

INSERT INTO public.product_categories (id, branch_id, name, slug, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Chicken', 'chicken', 10),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Lamb', 'lamb', 20),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Beef', 'beef', 30),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'Mince', 'mince', 40),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001', 'Steaks', 'steaks', 50),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000001', 'Family Packs', 'family-packs', 60)
ON CONFLICT (branch_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

INSERT INTO public.products (
  id,
  branch_id,
  category_id,
  name,
  slug,
  description,
  unit_type,
  price_per_unit,
  min_order_quantity,
  max_order_quantity,
  is_available,
  stock_status,
  requires_weight_confirmation,
  sort_order
)
VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Chicken Breast Fillets', 'chicken-breast-fillets', 'Fresh boneless chicken breast fillets prepared for quick weekday meals.', 'kg', 8.99, 0.5, 10, true, 'in_stock', true, 10),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Whole Chicken', 'whole-chicken', 'Whole HMC halal chicken, ideal for roasting or cutting down at home.', 'each', 6.50, 1, 8, true, 'in_stock', false, 20),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'Lamb Leg Steaks', 'lamb-leg-steaks', 'Lean lamb leg steaks cut for grilling, pan frying, or curry prep.', 'kg', 15.99, 0.5, 8, true, 'low_stock', true, 10),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', 'Beef Diced', 'beef-diced', 'Tender diced beef for stews, curries, and batch cooking.', 'kg', 12.49, 0.5, 10, true, 'in_stock', true, 10),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000104', 'Lean Lamb Mince', 'lean-lamb-mince', 'Fresh minced lamb prepared daily.', 'kg', 11.99, 0.5, 10, true, 'in_stock', true, 10),
  ('00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000105', 'Ribeye Steak', 'ribeye-steak', 'Premium ribeye steak cut to order.', 'kg', 24.99, 0.5, 5, true, 'in_stock', true, 10),
  ('00000000-0000-4000-8000-000000000207', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000106', 'Family Curry Pack', 'family-curry-pack', 'A balanced pack of chicken, lamb, and mince for the week ahead.', 'box', 35.00, 1, 4, true, 'in_stock', false, 10)
ON CONFLICT (branch_id, slug) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  unit_type = EXCLUDED.unit_type,
  price_per_unit = EXCLUDED.price_per_unit,
  min_order_quantity = EXCLUDED.min_order_quantity,
  max_order_quantity = EXCLUDED.max_order_quantity,
  is_available = EXCLUDED.is_available,
  stock_status = EXCLUDED.stock_status,
  requires_weight_confirmation = EXCLUDED.requires_weight_confirmation,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.pickup_windows (
  id,
  branch_id,
  label,
  start_time,
  end_time,
  cutoff_time,
  max_orders,
  days_of_week,
  window_type,
  is_active
)
VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', 'Drive Home Pickup', '16:30', '17:30', '15:30', 30, '{1,2,3,4,5}', 'commuter', true),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', 'Lunchtime', '12:00', '13:30', '11:00', 25, '{1,2,3,4,5,6}', 'standard', true),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', 'Saturday Morning', '09:00', '12:00', '08:00', 40, '{6}', 'weekend', true)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  cutoff_time = EXCLUDED.cutoff_time,
  max_orders = EXCLUDED.max_orders,
  days_of_week = EXCLUDED.days_of_week,
  window_type = EXCLUDED.window_type,
  is_active = EXCLUDED.is_active;
