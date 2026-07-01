-- Clean-stack API grants.
--
-- Newer local Supabase defaults no longer auto-expose public tables to the API
-- roles. RLS policies alone are not enough: PostgREST still requires table
-- privileges before those policies can be evaluated.
--
-- The server-only service role must be able to seed and read operational data.
-- Browser/authenticated access stays constrained: only profile SELECT is granted
-- here, and existing RLS policies still decide which profile rows are visible.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

GRANT SELECT ON public.profiles TO authenticated;
