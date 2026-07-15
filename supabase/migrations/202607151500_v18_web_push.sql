-- V18 B1 Phase 3 — verified Web Push delivery.
-- Forward-only from the sealed Phase 2.5 checkpoint. PostgreSQL remains the
-- authority; browser state is subscription input, display dedupe and open evidence.

-- 1. Device lifecycle facts ---------------------------------------------------
ALTER TABLE public.owner_notification_devices
  ADD COLUMN IF NOT EXISTS registered_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS invalidation_provider_code text,
  ADD COLUMN IF NOT EXISTS subscription_fingerprint text,
  ADD COLUMN IF NOT EXISTS verification_challenge_id uuid,
  ADD COLUMN IF NOT EXISTS verification_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz;

ALTER TABLE public.owner_notification_devices
  ADD CONSTRAINT owner_notification_devices_label_bound
    CHECK (device_label IS NULL OR length(device_label) <= 80),
  ADD CONSTRAINT owner_notification_devices_disabled_reason_bound
    CHECK (disabled_reason IS NULL OR length(disabled_reason) <= 200),
  ADD CONSTRAINT owner_notification_devices_invalidation_reason_bound
    CHECK (invalidation_reason IS NULL OR length(invalidation_reason) <= 200);

CREATE OR REPLACE VIEW public.eligible_owner_notification_devices_v18
WITH (security_invoker = true)
AS
SELECT *
FROM public.owner_notification_devices
WHERE channel = 'web_push'
  AND verified_at IS NOT NULL
  AND enabled = true
  AND invalidated_at IS NULL;

REVOKE ALL ON public.eligible_owner_notification_devices_v18 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.eligible_owner_notification_devices_v18 TO service_role;

-- 2. Verification challenges -------------------------------------------------
CREATE TABLE public.owner_notification_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.owner_notification_devices(id) ON DELETE CASCADE,
  dispatch_id uuid UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'confirmed', 'expired', 'cancelled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  failure_code text,
  subscription_fingerprint text NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX owner_notification_verification_one_open_idx
  ON public.owner_notification_verification_challenges(device_id)
  WHERE status IN ('pending', 'sent');

ALTER TABLE public.owner_notification_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_notification_verification_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_notification_verification_challenges TO service_role;

ALTER TABLE public.alert_dispatches DROP CONSTRAINT alert_dispatches_kind_check;
ALTER TABLE public.alert_dispatches ADD CONSTRAINT alert_dispatches_kind_check
  CHECK (kind IN ('critical_alert', 'daily_digest', 'device_verification'));
ALTER TABLE public.alert_dispatches DROP CONSTRAINT alert_dispatches_check;
ALTER TABLE public.alert_dispatches ADD CONSTRAINT alert_dispatches_check CHECK (
  (kind = 'critical_alert' AND alert_id IS NOT NULL)
  OR (kind IN ('daily_digest', 'device_verification') AND alert_id IS NULL)
);
ALTER TABLE public.owner_notification_verification_challenges
  ADD CONSTRAINT owner_notification_verification_dispatch_fkey
  FOREIGN KEY (dispatch_id) REFERENCES public.alert_dispatches(id) ON DELETE SET NULL;

-- 3. Private authority/audit helpers -----------------------------------------
CREATE OR REPLACE FUNCTION public.require_owner_notification_actor_v18(p_branch_id uuid)
RETURNS public.profiles
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid() AND is_active = true;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  IF v_profile.role <> 'owner' THEN RAISE EXCEPTION 'Owner authority required.' USING ERRCODE = '42501'; END IF;
  IF v_profile.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'Device does not belong to this owner shop.' USING ERRCODE = '42501';
  END IF;
  RETURN v_profile;
END;
$$;
REVOKE ALL ON FUNCTION public.require_owner_notification_actor_v18(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.write_notification_audit_v18(
  p_event text, p_device_id uuid, p_branch_id uuid, p_actor_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_event NOT IN (
    'notification_device_registered', 'notification_device_subscription_replaced',
    'notification_device_verification_sent', 'notification_device_verified',
    'notification_device_verification_expired', 'notification_device_disabled',
    'notification_device_reenabled', 'notification_device_invalidated',
    'notification_open_recorded'
  ) THEN RAISE EXCEPTION 'Invalid notification audit event.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (p_event, 'owner_notification_device', p_device_id, p_branch_id, p_actor_id, coalesce(p_metadata, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.write_notification_audit_v18(text,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 4. Registration -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_owner_notification_device_v18(
  p_branch_id uuid,
  p_installation_id uuid,
  p_device_label text,
  p_platform text,
  p_user_agent text,
  p_endpoint_ciphertext text,
  p_auth_ciphertext text,
  p_p256dh_ciphertext text,
  p_subscription_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_device public.owner_notification_devices%ROWTYPE;
  v_existing public.owner_notification_devices%ROWTYPE;
  v_replaced boolean := false;
BEGIN
  v_actor := public.require_owner_notification_actor_v18(p_branch_id);
  IF p_installation_id IS NULL OR length(coalesce(p_endpoint_ciphertext,'')) NOT BETWEEN 20 AND 8192
     OR length(coalesce(p_auth_ciphertext,'')) NOT BETWEEN 20 AND 2048
     OR length(coalesce(p_p256dh_ciphertext,'')) NOT BETWEEN 20 AND 4096
     OR length(coalesce(p_subscription_fingerprint,'')) <> 64 THEN
    RAISE EXCEPTION 'Invalid encrypted Web Push registration.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.owner_notification_devices
  WHERE owner_id = v_actor.id AND installation_id = p_installation_id AND channel = 'web_push'
  FOR UPDATE;
  v_replaced := v_existing.id IS NOT NULL
    AND v_existing.subscription_fingerprint IS DISTINCT FROM p_subscription_fingerprint;

  INSERT INTO public.owner_notification_devices(
    branch_id, owner_id, installation_id, channel, device_label, platform, user_agent,
    endpoint_ciphertext, auth_ciphertext, p256dh_ciphertext, subscription_fingerprint,
    enabled, verified_at, invalidated_at, invalidation_reason, invalidation_provider_code,
    registered_at, updated_at
  ) VALUES (
    p_branch_id, v_actor.id, p_installation_id, 'web_push', nullif(left(btrim(coalesce(p_device_label,'')),80),''),
    nullif(left(btrim(coalesce(p_platform,'')),80),''), nullif(left(btrim(coalesce(p_user_agent,'')),500),''),
    p_endpoint_ciphertext, p_auth_ciphertext, p_p256dh_ciphertext, p_subscription_fingerprint,
    true, NULL, NULL, NULL, NULL, now(), now()
  )
  ON CONFLICT (owner_id, installation_id, channel) DO UPDATE SET
    device_label = EXCLUDED.device_label,
    platform = EXCLUDED.platform,
    user_agent = EXCLUDED.user_agent,
    endpoint_ciphertext = EXCLUDED.endpoint_ciphertext,
    auth_ciphertext = EXCLUDED.auth_ciphertext,
    p256dh_ciphertext = EXCLUDED.p256dh_ciphertext,
    subscription_fingerprint = EXCLUDED.subscription_fingerprint,
    verified_at = CASE WHEN owner_notification_devices.subscription_fingerprint = EXCLUDED.subscription_fingerprint
      THEN owner_notification_devices.verified_at ELSE NULL END,
    verification_confirmed_at = CASE WHEN owner_notification_devices.subscription_fingerprint = EXCLUDED.subscription_fingerprint
      THEN owner_notification_devices.verification_confirmed_at ELSE NULL END,
    enabled = CASE WHEN owner_notification_devices.subscription_fingerprint = EXCLUDED.subscription_fingerprint
      THEN owner_notification_devices.enabled ELSE true END,
    invalidated_at = CASE WHEN owner_notification_devices.subscription_fingerprint = EXCLUDED.subscription_fingerprint
      THEN owner_notification_devices.invalidated_at ELSE NULL END,
    invalidation_reason = CASE WHEN owner_notification_devices.subscription_fingerprint = EXCLUDED.subscription_fingerprint
      THEN owner_notification_devices.invalidation_reason ELSE NULL END,
    invalidation_provider_code = CASE WHEN owner_notification_devices.subscription_fingerprint = EXCLUDED.subscription_fingerprint
      THEN owner_notification_devices.invalidation_provider_code ELSE NULL END,
    updated_at = now()
  RETURNING * INTO v_device;

  IF v_replaced THEN
    UPDATE public.owner_notification_verification_challenges
    SET status='cancelled',cancelled_at=now()
    WHERE device_id=v_device.id AND status IN ('pending','sent');
  END IF;

  PERFORM public.write_notification_audit_v18(
    CASE WHEN v_replaced THEN 'notification_device_subscription_replaced' ELSE 'notification_device_registered' END,
    v_device.id, p_branch_id, v_actor.id,
    jsonb_build_object('installation_id', p_installation_id, 'reverification_required', v_replaced)
  );
  RETURN jsonb_build_object('device_id', v_device.id, 'status',
    CASE WHEN v_device.invalidated_at IS NOT NULL THEN 'invalidated'
         WHEN NOT v_device.enabled THEN 'disabled'
         WHEN v_device.verified_at IS NULL THEN 'unverified' ELSE 'active' END,
    'verification_required', v_device.verified_at IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.register_owner_notification_device_v18(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_owner_notification_device_v18(uuid,uuid,text,text,text,text,text,text,text) TO authenticated;

-- 5. Real adapter-backed verification dispatch --------------------------------
CREATE OR REPLACE FUNCTION public.expire_owner_notification_verifications_v18()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer:=0; v_row record;
BEGIN
  FOR v_row IN
    UPDATE public.owner_notification_verification_challenges c SET status='expired'
    WHERE c.status IN ('pending','sent') AND c.expires_at<=now()
    RETURNING c.id,c.device_id
  LOOP
    v_count:=v_count+1;
    PERFORM public.write_notification_audit_v18('notification_device_verification_expired',d.id,d.branch_id,NULL,
      jsonb_build_object('challenge_id',v_row.id)) FROM public.owner_notification_devices d WHERE d.id=v_row.device_id;
  END LOOP;
  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.expire_owner_notification_verifications_v18() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_owner_notification_verifications_v18() TO service_role;

CREATE OR REPLACE FUNCTION public.create_owner_notification_verification_v18(p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_device public.owner_notification_devices%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_challenge uuid := gen_random_uuid();
  v_dispatch uuid := gen_random_uuid();
  v_expires timestamptz := now() + interval '15 minutes';
BEGIN
  PERFORM public.expire_owner_notification_verifications_v18();
  SELECT * INTO v_device FROM public.owner_notification_devices WHERE id = p_device_id FOR UPDATE;
  IF v_device.id IS NULL THEN RAISE EXCEPTION 'Device not found.' USING ERRCODE = 'P0002'; END IF;
  v_actor := public.require_owner_notification_actor_v18(v_device.branch_id);
  IF v_device.owner_id <> v_actor.id THEN RAISE EXCEPTION 'Device not owned by caller.' USING ERRCODE = '42501'; END IF;

  UPDATE public.owner_notification_verification_challenges
  SET status = 'cancelled', cancelled_at = now()
  WHERE device_id = v_device.id AND status IN ('pending','sent');

  INSERT INTO public.alert_dispatches(
    id, branch_id, kind, channel, device_id, priority, status, dispatch_key, payload
  ) VALUES (
    v_dispatch, v_device.branch_id, 'device_verification', 'web_push', v_device.id, 200, 'pending',
    'device-verification:' || v_challenge::text,
    jsonb_build_object(
      'schemaVersion', 1, 'messageType', 'device_verification', 'dispatchId', v_dispatch,
      'challengeId', v_challenge, 'title', 'PTM notifications are ready',
      'body', 'Open this notification, then confirm it in PTM.',
      'route', '/admin/settings/notifications?verify=' || v_challenge::text,
      'createdAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
  INSERT INTO public.owner_notification_verification_challenges(id,device_id,dispatch_id,status,expires_at,subscription_fingerprint)
  VALUES (v_challenge,v_device.id,v_dispatch,'pending',v_expires,v_device.subscription_fingerprint);
  UPDATE public.owner_notification_devices SET verification_challenge_id=v_challenge,
    verification_sent_at=now(), verification_expires_at=v_expires, updated_at=now() WHERE id=v_device.id;
  PERFORM public.write_notification_audit_v18('notification_device_verification_sent',v_device.id,v_device.branch_id,v_actor.id,
    jsonb_build_object('challenge_id',v_challenge,'dispatch_id',v_dispatch,'expires_at',v_expires));
  RETURN jsonb_build_object('challenge_id',v_challenge,'dispatch_id',v_dispatch,'expires_at',v_expires);
END;
$$;
REVOKE ALL ON FUNCTION public.create_owner_notification_verification_v18(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_owner_notification_verification_v18(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_owner_notification_verification_v18(p_device_id uuid,p_challenge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_device public.owner_notification_devices%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_challenge public.owner_notification_verification_challenges%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_device FROM public.owner_notification_devices WHERE id=p_device_id FOR UPDATE;
  IF v_device.id IS NULL THEN RAISE EXCEPTION 'Device not found.' USING ERRCODE='P0002'; END IF;
  v_actor := public.require_owner_notification_actor_v18(v_device.branch_id);
  IF v_device.owner_id <> v_actor.id THEN RAISE EXCEPTION 'Device not owned by caller.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_challenge FROM public.owner_notification_verification_challenges
  WHERE id=p_challenge_id AND device_id=p_device_id FOR UPDATE;
  IF v_challenge.id IS NULL THEN RAISE EXCEPTION 'Verification challenge does not match this device.' USING ERRCODE='22023'; END IF;
  IF v_challenge.subscription_fingerprint IS DISTINCT FROM v_device.subscription_fingerprint THEN
    RAISE EXCEPTION 'Verification challenge belongs to a replaced subscription.' USING ERRCODE='55000';
  END IF;
  IF v_challenge.status='confirmed' THEN
    RETURN jsonb_build_object('device_id',v_device.id,'status','active','verified_at',v_device.verified_at);
  END IF;
  IF v_challenge.status NOT IN ('pending','sent') THEN RAISE EXCEPTION 'Verification challenge is not active.' USING ERRCODE='55000'; END IF;
  IF v_challenge.expires_at <= now() THEN RAISE EXCEPTION 'Verification challenge has expired.' USING ERRCODE='55000'; END IF;
  SELECT status INTO v_status FROM public.alert_dispatches WHERE id=v_challenge.dispatch_id;
  IF v_status <> 'accepted' THEN RAISE EXCEPTION 'Verification notification has not been accepted by the push service.' USING ERRCODE='55000'; END IF;
  UPDATE public.owner_notification_verification_challenges SET status='confirmed',confirmed_at=now() WHERE id=v_challenge.id;
  UPDATE public.owner_notification_devices SET verified_at=coalesce(verified_at,now()),
    verification_confirmed_at=coalesce(verification_confirmed_at,now()), enabled=true,
    disabled_at=NULL,disabled_by=NULL,disabled_reason=NULL,updated_at=now() WHERE id=v_device.id
    RETURNING verified_at INTO v_device.verified_at;
  PERFORM public.write_notification_audit_v18('notification_device_verified',v_device.id,v_device.branch_id,v_actor.id,
    jsonb_build_object('challenge_id',v_challenge.id,'dispatch_id',v_challenge.dispatch_id));
  RETURN jsonb_build_object('device_id',v_device.id,'status','active','verified_at',v_device.verified_at);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_owner_notification_verification_v18(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_owner_notification_verification_v18(uuid,uuid) TO authenticated;

-- 6. Disable, re-enable, rename and open evidence -----------------------------
CREATE OR REPLACE FUNCTION public.set_owner_notification_device_enabled_v18(p_device_id uuid,p_enabled boolean,p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_device public.owner_notification_devices%ROWTYPE; v_actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_device FROM public.owner_notification_devices WHERE id=p_device_id FOR UPDATE;
  IF v_device.id IS NULL THEN RAISE EXCEPTION 'Device not found.' USING ERRCODE='P0002'; END IF;
  v_actor := public.require_owner_notification_actor_v18(v_device.branch_id);
  IF v_device.owner_id<>v_actor.id THEN RAISE EXCEPTION 'Device not owned by caller.' USING ERRCODE='42501'; END IF;
  IF p_enabled AND (v_device.invalidated_at IS NOT NULL OR v_device.verified_at IS NULL) THEN
    RAISE EXCEPTION 'This device must reconnect and verify before it can be enabled.' USING ERRCODE='55000';
  END IF;
  UPDATE public.owner_notification_devices SET enabled=p_enabled,
    disabled_at=CASE WHEN p_enabled THEN NULL ELSE now() END,
    disabled_by=CASE WHEN p_enabled THEN NULL ELSE v_actor.id END,
    disabled_reason=CASE WHEN p_enabled THEN NULL ELSE coalesce(nullif(left(btrim(coalesce(p_reason,'')),200),''),'Disabled by owner') END,
    updated_at=now() WHERE id=v_device.id;
  PERFORM public.write_notification_audit_v18(CASE WHEN p_enabled THEN 'notification_device_reenabled' ELSE 'notification_device_disabled' END,
    v_device.id,v_device.branch_id,v_actor.id,jsonb_build_object('reason',CASE WHEN p_enabled THEN NULL ELSE coalesce(p_reason,'Disabled by owner') END));
  RETURN jsonb_build_object('device_id',v_device.id,'status',CASE WHEN p_enabled THEN 'active' ELSE 'disabled' END);
END;
$$;
REVOKE ALL ON FUNCTION public.set_owner_notification_device_enabled_v18(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_owner_notification_device_enabled_v18(uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_owner_notification_device_v18(p_device_id uuid,p_device_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_device public.owner_notification_devices%ROWTYPE; v_actor public.profiles%ROWTYPE; v_label text;
BEGIN
  v_label:=nullif(left(btrim(coalesce(p_device_label,'')),80),'');
  IF v_label IS NULL THEN RAISE EXCEPTION 'Device name is required.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_device FROM public.owner_notification_devices WHERE id=p_device_id FOR UPDATE;
  IF v_device.id IS NULL THEN RAISE EXCEPTION 'Device not found.' USING ERRCODE='P0002'; END IF;
  v_actor:=public.require_owner_notification_actor_v18(v_device.branch_id);
  IF v_device.owner_id<>v_actor.id THEN RAISE EXCEPTION 'Device not owned by caller.' USING ERRCODE='42501'; END IF;
  UPDATE public.owner_notification_devices SET device_label=v_label,updated_at=now() WHERE id=v_device.id;
  RETURN jsonb_build_object('device_id',v_device.id,'device_label',v_label);
END; $$;
REVOKE ALL ON FUNCTION public.rename_owner_notification_device_v18(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_owner_notification_device_v18(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_owner_notification_opened_v18(p_dispatch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_dispatch public.alert_dispatches%ROWTYPE; v_device public.owner_notification_devices%ROWTYPE; v_actor public.profiles%ROWTYPE; v_first boolean;
BEGIN
  SELECT * INTO v_dispatch FROM public.alert_dispatches WHERE id=p_dispatch_id AND channel='web_push' FOR UPDATE;
  IF v_dispatch.id IS NULL THEN RAISE EXCEPTION 'Web Push dispatch not found.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_device FROM public.owner_notification_devices WHERE id=v_dispatch.device_id;
  IF v_device.id IS NULL THEN RAISE EXCEPTION 'Dispatch device not found.' USING ERRCODE='P0002'; END IF;
  v_actor:=public.require_owner_notification_actor_v18(v_dispatch.branch_id);
  IF v_device.owner_id<>v_actor.id THEN RAISE EXCEPTION 'Dispatch not owned by caller.' USING ERRCODE='42501'; END IF;
  v_first:=v_dispatch.notification_opened_at IS NULL;
  UPDATE public.alert_dispatches SET notification_opened_at=coalesce(notification_opened_at,now()),updated_at=now()
  WHERE id=v_dispatch.id RETURNING notification_opened_at INTO v_dispatch.notification_opened_at;
  IF v_first THEN PERFORM public.write_notification_audit_v18('notification_open_recorded',v_device.id,v_device.branch_id,v_actor.id,
    jsonb_build_object('dispatch_id',v_dispatch.id,'alert_id',v_dispatch.alert_id)); END IF;
  RETURN jsonb_build_object('dispatch_id',v_dispatch.id,'notification_opened_at',v_dispatch.notification_opened_at,'changed',v_first);
END; $$;
REVOKE ALL ON FUNCTION public.record_owner_notification_opened_v18(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_owner_notification_opened_v18(uuid) TO authenticated;

-- 7. Canonical fan-out and invalidation audit ---------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_critical_owner_alert_dispatch_v18()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_target text := '';
BEGIN
  IF NEW.severity <> 'critical' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.severity='critical' THEN RETURN NEW; END IF;
  SELECT coalesce(owner_contact,'') INTO v_target FROM public.branch_operator_settings WHERE branch_id=NEW.branch_id;
  INSERT INTO public.alert_dispatches(branch_id,alert_id,kind,channel,target,priority,status,dispatch_key,payload,next_attempt_at)
  VALUES(NEW.branch_id,NEW.id,'critical_alert','twilio_whatsapp',coalesce(v_target,''),100,'pending',
    'critical-alert:'||NEW.id::text,jsonb_build_object('message',NEW.summary,'alert_kind',NEW.kind,'entity_ref',NEW.entity_ref),now());
  INSERT INTO public.alert_dispatches(branch_id,alert_id,kind,channel,device_id,target,priority,status,dispatch_key,payload,next_attempt_at)
  SELECT NEW.branch_id,NEW.id,'critical_alert','web_push',d.id,'',100,'pending',
    'critical-alert:'||NEW.id::text||':web_push:'||d.id::text,
    jsonb_build_object('schemaVersion',1,'messageType','owner_alert','dispatchId',gen_random_uuid(),
      'alertId',NEW.id,'alertKind',NEW.kind,'severity',NEW.severity,
      'title','Urgent shop alert','body','Open PTM to review this alert.',
      'route','/admin/today?alert='||NEW.id::text,
      'createdAt',to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),now()
  FROM public.eligible_owner_notification_devices_v18 d WHERE d.branch_id=NEW.branch_id;
  -- Replace the provisional payload identity with the actual stable dispatch id.
  UPDATE public.alert_dispatches SET payload=jsonb_set(payload,'{dispatchId}',to_jsonb(id::text))
  WHERE alert_id=NEW.id AND channel='web_push';
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.audit_owner_notification_invalidation_v18()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL THEN
    SELECT a.provider_status_code INTO NEW.invalidation_provider_code
    FROM public.alert_delivery_attempts a
    JOIN public.alert_dispatches d ON d.id=a.dispatch_id
    WHERE d.device_id=NEW.id AND a.completed_at IS NOT NULL
    ORDER BY a.completed_at DESC LIMIT 1;
    NEW.invalidation_provider_code:=coalesce(NEW.invalidation_provider_code,OLD.invalidation_provider_code);
    PERFORM public.write_notification_audit_v18('notification_device_invalidated',NEW.id,NEW.branch_id,NULL,
      jsonb_build_object('provider_code',NEW.invalidation_provider_code,'reason',NEW.invalidation_reason));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS owner_notification_device_invalidation_audit_v18 ON public.owner_notification_devices;
CREATE TRIGGER owner_notification_device_invalidation_audit_v18
BEFORE UPDATE OF invalidated_at ON public.owner_notification_devices
FOR EACH ROW EXECUTE FUNCTION public.audit_owner_notification_invalidation_v18();

-- 8. Health -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.web_push_health_v18()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'verified_active_devices',count(*) FILTER(WHERE verified_at IS NOT NULL AND enabled AND invalidated_at IS NULL),
    'unverified_devices',count(*) FILTER(WHERE verified_at IS NULL AND invalidated_at IS NULL),
    'invalidated_devices',count(*) FILTER(WHERE invalidated_at IS NOT NULL),
    'disabled_devices',count(*) FILTER(WHERE NOT enabled AND invalidated_at IS NULL),
    'oldest_retry_seconds',coalesce((SELECT extract(epoch FROM now()-min(created_at))::bigint FROM public.alert_dispatches
      WHERE channel='web_push' AND status IN('retry_wait','delivery_unknown')),0),
    'dead_letter_count',(SELECT count(*) FROM public.alert_dispatches WHERE channel='web_push' AND status='dead_letter')
  ) FROM public.owner_notification_devices WHERE channel='web_push';
$$;
REVOKE ALL ON FUNCTION public.web_push_health_v18() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_push_health_v18() TO service_role;
