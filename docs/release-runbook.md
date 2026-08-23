# Release Runbook

PTM production releases use one authority path: the `Production Release` GitHub
workflow. A health response is evidence, not permission to route traffic.

## Required platform controls

Before Phase 1 can be certified, an owner must verify these settings outside the
repository:

- Vercel Production has automatic custom-domain assignment disabled.
- Vercel Git deployments are disabled. The project is currently Git-linked, so
  leaving them enabled would create a second production build path from `main`.
- On RBAC-capable Vercel plans, human roles do not hold `Full Production
  Deployment`; that permission belongs only to the GitHub release identity.
- On the current Hobby plan, PTM uses the documented single-owner exception:
  the owner token is stored only in the protected GitHub environment, while Git
  deployments and automatic domain assignment remain disabled. Deployments
  still use the same immutable stage, certify and promote workflow.
- The GitHub `production` environment requires an owner reviewer and exposes the
  production Supabase and Vercel secrets only to that environment.
- Main is protected and all quality, database-security, migration-upgrade and
  application-E2E checks are required.
- If a Vercel Checks integration is installed, its PTM release check is blocking.
  The Checks API requires an OAuth integration; a normal Vercel access token is
  not sufficient to create that check from this repository.

If any applicable control is absent, the release truth boundary is not
certified. `verify:vercel-control-plane` enforces both Vercel routing settings,
verifies the plan, and records whether deployment authority is RBAC-restricted
or operating under the Hobby single-owner exception.

## 1. Pre-flight

Work from a clean commit descended from the certified V18 checkpoint:

```powershell
git diff --check
corepack pnpm verify:release-lineage --require-clean
corepack pnpm verify:migration-manifest
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm architecture:check
corepack pnpm build
```

Do not proceed with a failure or a skipped database suite.

## 2. Expand database contract

Phase 1 contains only the expand migration `202608130900`. It installs the two
P0 truth seals and advertises app generations 18-19. It deliberately preserves
`get_applied_migration_versions()` so the currently serving generation 18 app
continues to work.

```powershell
npx supabase db push --linked --dry-run
```

The dry run must show exactly the expected expand migration and no retirement
migration. After confirming the linked production project, take and verify the
backup, then apply the expand migration using the normal linked migration flow.
Verify generation 18 against the expanded DB before dispatching the release.

## 3. Stage and promote one immutable artifact

Dispatch `Production Release` for `main`. The workflow:

1. reruns the local DB, truth, migration, type, lint, unit, architecture and build gates;
2. checks the live DB generation range and named P0 migration floor;
3. creates a production deployment with `--skip-domain`;
4. tests that exact immutable deployment URL;
5. records its commit, app generation, URL and live DB contract in a certificate;
6. re-runs the promotion gate against that URL;
7. promotes that same URL without rebuilding; and
8. verifies the production alias reports the same commit and generation.

Do not deploy, promote, alias or roll back from a developer checkout or the Vercel
dashboard. Those paths must also be denied by Vercel permissions.

## 4. Contract in a later release

Do not add the retirement migration to the Phase-1 expand commit. Supabase applies
all pending migrations; including it now would erase the compatibility overlap.

Only after generation 19 is current and verified, create a new timestamped forward
migration that atomically:

1. asserts the current contract is DB generation 19 with range 18-19;
2. updates `min_supported_app_generation` to 19; and
3. revokes `get_applied_migration_versions()` from `PUBLIC`, `anon`,
   `authenticated` and `service_role`.

Its PR must prove App 18/contracted DB is denied and App 19 remains allowed. Once
applied, rollback to generation 18 is forbidden; fix forward with generation 19.

## 5. Incident policy

During expand overlap, only an already certified artifact whose application
generation remains inside the live DB range is eligible for promotion. After
contraction, generation 18 is ineligible even if it once served production.
Uncertified deployments, different commits, dirty rebuilds and pre-lineage commits
are always denied.
