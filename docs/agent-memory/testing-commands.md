# PTM validation commands that actually work (verified 2026-07-14)

Package manager: `corepack pnpm` (pnpm is not on PATH). Node 24 (engines `>=24 <25`).

## No services needed

- `corepack pnpm typecheck`
- `corepack pnpm test` - Vitest: 712 passed, 1 skipped (96 passed files, 1 skipped file)
- `corepack pnpm lint` - zero errors; six accepted pre-existing warnings
- `corepack pnpm build`
- `corepack pnpm architecture:check` - static tier: 8/8 guards
- `node scripts/verify-rls-coverage.mjs`

## Local Supabase needed (Docker Desktop must be started manually)

- `docker ps` fails until Docker Desktop is launched
  (`Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`); the
  `supabase_*` containers auto-start with it.
- `npx supabase db reset` - applies all 53 migrations from a clean database.
- `node scripts/seed-dev.mjs`
- `corepack pnpm architecture:check -- --tier=db` - 8/8 adversarial DB guards.
- `node scripts/verify-v11-migrations.mjs` - validates the complete clean and upgrade
  migration paths, including extension bootstrap.

## Live tier (app running against seeded local stack)

- `corepack pnpm build; $env:CANONICAL_BRANCH_ID='00000000-0000-4000-8000-000000000001'; npx next start -p 3001`
  (`CANONICAL_BRANCH_ID` is not in `.env.local`; without it, `next start` health is
  `503 CONFIGURATION_REQUIRED` because `next start` counts as production runtime.)
- `$env:BASE='http://127.0.0.1:3001'; corepack pnpm architecture:check -- --tier=live`
  - 7/7 live guards.
- Everything at once: `corepack pnpm architecture:check:all`.

## Browser suite

- `corepack pnpm playwright:full` - 105/105 browser tests.
- For local runs the wrapper resets and reseeds Supabase before Playwright. This is
  intentional: append-only payment and operator-sale truth cannot be cleaned safely
  by test teardown alone.
- Set `PLAYWRIGHT_SKIP_DB_RESET=true` only when the caller already established a
  deterministic database. `PLAYWRIGHT_SKIP_BUILD=true` reuses a known-good build.
- Counter Realtime recovery soak:
  `corepack pnpm exec playwright test tests/e2e/counter-realtime.spec.ts --repeat-each=3`
  - 6/6 passed, with cross-context visibility kept within three seconds even when the
  local Realtime socket degraded and the UI honestly reported reconnecting.

## Release gates

- `corepack pnpm release:gate` - local repository/runtime checks pass; production-only
  checks skip when production credentials are absent.
- `corepack pnpm production:readiness` - local readiness checks pass; seven
  production-environment checks skip without production credentials.
- A production release-mode invocation must fail closed when build SHA, linked
  production credentials, or backup evidence is absent. That failure is the expected
  safety boundary, not a local validation failure.

## Gotchas

- Seeded logins: `owner@ptm.test`, `manager@ptm.test`, `staff@ptm.test`,
  `staff.b@ptm.test`, and `inactive@ptm.test`; password `PlaiceTest123!`.
- Local DB persists between sessions. Adversarial scripts must clean up after
  themselves and never assume a fresh DB.
- Guards that touch `compliance_logs` or `CURRENT_DATE` must use UTC dates
  (`new Date().toISOString().slice(0, 10)`), never runner-local dates.
