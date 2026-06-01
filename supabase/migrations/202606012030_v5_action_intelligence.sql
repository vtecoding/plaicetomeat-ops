-- V5 action intelligence release marker.
-- The owner-action engine is application code, but production closure still
-- requires a migration version so drift checks can prove the release was applied.

INSERT INTO public.expected_migrations(version, name)
VALUES ('202606012030', 'v5_action_intelligence')
ON CONFLICT (version) DO UPDATE SET name = excluded.name, required = true;
