-- Keep local/CI service-role clients privileged after the Supabase CLI default
-- grant behavior change. App roles still rely on explicit policies/RPC grants;
-- this only restores the expected server-side service_role authority used by
-- seed-dev and privileged server actions.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- RLS policies still decide which rows are visible. These SELECT grants make the
-- policies reachable through PostgREST under the new explicit-grants default.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT ON public.order_notes TO authenticated;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- Several historical function redefinitions re-granted this helper to
-- authenticated so SECURITY INVOKER flows could write audit rows. Final app
-- flows now use SECURITY DEFINER wrappers, so keep direct audit emission private.
REVOKE ALL ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  TO service_role;
