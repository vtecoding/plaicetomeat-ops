# V12.0 Baseline

Date: 2026-06-06  
Baseline commit: `fb9985ccab3ba1291daa85870bbe8d672b273332`  
Scope: V12.0 Reproducible Foundation and V12.1 Database Authority Seal start point

## Migration count

Repository migrations at baseline: 19 SQL files in `supabase/migrations`.

## Lockfile state

Before V12.0:

- `pnpm-lock.yaml`: present
- `package-lock.json`: present
- `package.json` declared `packageManager: pnpm@9.15.9`

After V12.0:

- `pnpm-lock.yaml`: retained as the single lockfile
- `package-lock.json`: removed
- `package.json` declares `engines.node` and `engines.pnpm`
- `.nvmrc` pins the standard Node version for local and CI use

## Environment requirements

Required runtime/toolchain:

- Node.js `>=20.11.0 <25`
- pnpm `9.15.9`
- Supabase project configuration for live database access
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for server-only privileged flows
- `ORDER_ACCESS_SECRET` with at least 32 bytes in production

Operational/test requirements:

- Docker for local Supabase-backed migration and e2e checks
- Supabase CLI available through `npx supabase`
- Vercel deployment credentials for production deployment

## Deployment status

No deployment was performed as part of this baseline.

Production migration parity and deployment state are not proven from tracked files
alone. They remain operator-gated checks before launch, following
`docs/release-runbook.md`.
