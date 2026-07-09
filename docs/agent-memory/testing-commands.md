# PTM validation commands that actually work (verified 2026-07-10)

Package manager: `corepack pnpm` (pnpm not on PATH). Node 24 (engines `>=24 <25`).

## No services needed
- `corepack pnpm typecheck`
- `corepack pnpm test`            # vitest, ~620 tests, ~2s
- `corepack pnpm lint`
- `corepack pnpm build`
- `corepack pnpm architecture:check`             # static tier, 7 guards
- `node scripts/verify-rls-coverage.mjs`

## Local Supabase needed (Docker Desktop must be started manually)
- `docker ps` fails until Docker Desktop is launched
  (`Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`); the
  supabase_* containers auto-start with it.
- `npx supabase migration up`     # may need --include-all if a lower-timestamped
                                  # file appears after history (only safe for
                                  # additive migrations — check first!)
- `node scripts/seed-dev.mjs`
- `corepack pnpm architecture:check -- --tier=db`   # 6 adversarial db guards

## Live tier (app running against seeded local stack)
- `corepack pnpm build; $env:CANONICAL_BRANCH_ID='00000000-0000-4000-8000-000000000001'; npx next start -p 3001`
  (CANONICAL_BRANCH_ID is NOT in .env.local; without it, `next start` health = 503
  CONFIGURATION_REQUIRED because next start counts as production runtime.)
- `$env:BASE='http://127.0.0.1:3001'; corepack pnpm architecture:check -- --tier=live`
- Everything at once: `corepack pnpm architecture:check:all`

## Gotchas
- PowerShell 5.1 mangles embedded double quotes in `git commit -m @'…'@` heredocs
  → write the message to a file and `git commit -F <file>`.
- Seeded logins: owner@ptm.test / manager@ptm.test / staff@ptm.test /
  staff.b@ptm.test / inactive@ptm.test — password `PlaiceTest123!`.
- Local DB persists between sessions; adversarial scripts must clean up after
  themselves and never assume a fresh DB.
- Guards that touch `compliance_logs`/CURRENT_DATE must use UTC dates
  (`new Date().toISOString().slice(0,10)`), never runner-local dates.
