-- V18 B7 — certificates leave the operator's opening ritual. The scheduled B1
-- worker calls scan_branch_certificate_expiry_alerts_v18 with each branch's
-- own local business date before composing its digest.

-- Opening definition v2 deliberately omits certs_visible. Existing sessions
-- remain bound to their historical definition; only new sessions use v2.
INSERT INTO public.ops_checklist_definitions(id, kind, definition_key, version, title, is_active)
VALUES ('00000000-0000-4000-8000-000000001264', 'opening', 'opening', 2, 'Opening the shop', true)
ON CONFLICT (definition_key, version) DO UPDATE
SET title = excluded.title, is_active = excluded.is_active;

INSERT INTO public.ops_checklist_definition_steps(
  definition_id, step_key, title, input_kind, unit, required, critical,
  min_value, max_value, sort_order
)
VALUES
  ('00000000-0000-4000-8000-000000001264', 'fridge_temp', 'Check the fridge & display are cold', 'number', 'C', true, true, -30, 30, 10),
  ('00000000-0000-4000-8000-000000001264', 'display_ready', 'Counter and display set up', 'confirm', null, true, false, null, null, 20),
  ('00000000-0000-4000-8000-000000001264', 'float_ready', 'Till float counted and ready', 'number', 'GBP', true, false, 0, 10000, 30),
  ('00000000-0000-4000-8000-000000001264', 'open_sign', 'Open sign on, lights up', 'confirm', null, true, false, null, null, 40)
ON CONFLICT (definition_id, step_key) DO UPDATE
SET title = excluded.title,
    input_kind = excluded.input_kind,
    unit = excluded.unit,
    required = excluded.required,
    critical = excluded.critical,
    min_value = excluded.min_value,
    max_value = excluded.max_value,
    sort_order = excluded.sort_order;

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_certificate_document_uniq
  ON public.owner_alerts (branch_id, kind, entity_ref)
  WHERE kind = 'certificate_expiring';

DROP FUNCTION IF EXISTS public.scan_certificate_expiry_alerts_v18(date);

CREATE OR REPLACE FUNCTION public.scan_branch_certificate_expiry_alerts_v18(
  p_branch_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'Branch not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Renewed documents supersede an older document of the same supplier/type.
  -- Resolve alerts which are no longer the current certificate or no longer sit
  -- inside the 30-day window.
  WITH current_risk AS (
    SELECT p_branch_id AS branch_id, d.id AS document_id
    FROM public.suppliers s
    JOIN public.supplier_documents d ON d.supplier_id = s.id
    WHERE (s.branch_id = p_branch_id OR s.branch_id IS NULL)
      AND coalesce(s.active, true)
      AND d.expiry_date IS NOT NULL
      AND d.expiry_date <= p_as_of + 30
      AND NOT EXISTS (
        SELECT 1 FROM public.supplier_documents newer
        WHERE newer.supplier_id = d.supplier_id
          AND newer.document_type = d.document_type
          AND newer.expiry_date > d.expiry_date
      )
  ), resolved AS (
    UPDATE public.owner_alerts a
    SET resolved_at = now(),
        resolution_note = coalesce(a.resolution_note, 'Resolved automatically after the supplier document was renewed or moved out of the alert window.'),
        seen_at = coalesce(a.seen_at, now())
    WHERE a.kind = 'certificate_expiring'
      AND a.branch_id = p_branch_id
      AND a.resolved_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM current_risk r
        WHERE r.branch_id = a.branch_id
          AND a.entity_ref = 'supplier_document:' || r.document_id::text
      )
    RETURNING a.id, a.kind, a.entity_ref
  )
  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, metadata)
  SELECT
    'owner_alert_lifecycle_changed', 'owner_alert', id, p_branch_id,
    jsonb_build_object(
      'kind', kind,
      'entity_ref', entity_ref,
      'transition', 'auto_resolved',
      'rule', 'certificate_renewal_or_window'
    )
  FROM resolved;

  WITH risk AS (
    SELECT
      p_branch_id AS branch_id,
      d.id AS document_id,
      d.document_type,
      d.expiry_date,
      s.name AS supplier_name,
      (d.expiry_date - p_as_of) AS days_left
    FROM public.suppliers s
    JOIN public.supplier_documents d ON d.supplier_id = s.id
    WHERE (s.branch_id = p_branch_id OR s.branch_id IS NULL)
      AND coalesce(s.active, true)
      AND d.expiry_date IS NOT NULL
      AND d.expiry_date <= p_as_of + 30
      AND NOT EXISTS (
        SELECT 1 FROM public.supplier_documents newer
        WHERE newer.supplier_id = d.supplier_id
          AND newer.document_type = d.document_type
          AND newer.expiry_date > d.expiry_date
      )
  ), existing AS (
    SELECT a.id, a.severity, a.summary, a.resolved_at
    FROM public.owner_alerts a
    JOIN risk r
      ON a.branch_id = r.branch_id
     AND a.kind = 'certificate_expiring'
     AND a.entity_ref = 'supplier_document:' || r.document_id::text
  ), upserted AS (
    INSERT INTO public.owner_alerts(
      branch_id, severity, kind, summary, entity_ref, created_by
    )
    SELECT
      r.branch_id,
      CASE WHEN r.days_left <= 7 THEN 'critical' ELSE 'warning' END,
      'certificate_expiring',
      CASE
        WHEN r.days_left < 0 THEN r.supplier_name || '''s ' || replace(r.document_type, '_', ' ') || ' expired ' || abs(r.days_left) || ' day' || CASE WHEN abs(r.days_left) = 1 THEN '' ELSE 's' END || ' ago.'
        WHEN r.days_left = 0 THEN r.supplier_name || '''s ' || replace(r.document_type, '_', ' ') || ' expires today.'
        ELSE r.supplier_name || '''s ' || replace(r.document_type, '_', ' ') || ' expires in ' || r.days_left || ' days.'
      END,
      'supplier_document:' || r.document_id::text,
      NULL
    FROM risk r
    ON CONFLICT (branch_id, kind, entity_ref) WHERE kind = 'certificate_expiring'
    DO UPDATE SET
      severity = excluded.severity,
      summary = excluded.summary,
      resolved_at = NULL,
      resolution_note = NULL,
      seen_at = CASE WHEN public.owner_alerts.resolved_at IS NULL THEN public.owner_alerts.seen_at ELSE NULL END,
      claimed_by = CASE WHEN public.owner_alerts.resolved_at IS NULL THEN public.owner_alerts.claimed_by ELSE NULL END,
      claimed_at = CASE WHEN public.owner_alerts.resolved_at IS NULL THEN public.owner_alerts.claimed_at ELSE NULL END
    WHERE public.owner_alerts.resolved_at IS NOT NULL
       OR public.owner_alerts.severity IS DISTINCT FROM excluded.severity
       OR public.owner_alerts.summary IS DISTINCT FROM excluded.summary
    RETURNING
      id, branch_id, kind, entity_ref, severity, summary,
      (xmax = 0) AS inserted
  ), audited AS (
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, metadata)
    SELECT
      'owner_alert_lifecycle_changed', 'owner_alert', u.id, u.branch_id,
      jsonb_build_object(
        'kind', u.kind,
        'entity_ref', u.entity_ref,
        'transition', transition.name,
        'from_severity', e.severity,
        'to_severity', u.severity
      )
    FROM upserted u
    LEFT JOIN existing e ON e.id = u.id
    CROSS JOIN LATERAL (
      SELECT 'created'::text AS name WHERE u.inserted
      UNION ALL
      SELECT 'reopened' WHERE NOT u.inserted AND e.resolved_at IS NOT NULL
      UNION ALL
      SELECT 'escalated'
      WHERE NOT u.inserted AND e.severity = 'warning' AND u.severity = 'critical'
      UNION ALL
      SELECT 'refreshed'
      WHERE NOT u.inserted
        AND e.resolved_at IS NULL
        AND e.severity IS NOT DISTINCT FROM u.severity
        AND e.summary IS DISTINCT FROM u.summary
    ) transition
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_branch_certificate_expiry_alerts_v18(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_branch_certificate_expiry_alerts_v18(uuid, date) TO service_role;
