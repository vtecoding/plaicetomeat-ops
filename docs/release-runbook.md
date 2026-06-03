# Release Runbook

_How to ship PlaiceToMeat safely. Read this before every deploy. The golden rule:
**`git push` does not deploy anything**, and **database changes are never
automatic**. Both are manual steps you have to run on purpose._

This project deploys to Vercel via the CLI (not git-integrated) and uses a linked
Supabase project for the database. Production alias:
`https://plaicetomeat-ops.vercel.app`.

---

## 1. Pre-flight (run locally, must be green)

```bash
git status                 # working tree clean / on the right branch
git diff --stat
git diff --check           # no whitespace/merge-marker errors
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test         # vitest unit tests
corepack pnpm build
corepack pnpm test:e2e     # needs Docker + local Supabase up and seeded
```

E2E needs the local stack: `npx supabase start` (Docker Desktop must be running),
then `node scripts/seed-dev.mjs` to seed users/branch/orders. The e2e harness runs
`next start -p 3100`, so a fresh `build` must exist first.

**Do not proceed if any step fails.** Never weaken a test to make it pass.

---

## 2. Database migration (only if you added a migration file)

Adding any `supabase/migrations/*.sql` file means production needs that migration
**before** you deploy — otherwise the release report's drift check fails and the new
code can hit a column/RPC that doesn't exist yet.

```bash
supabase migration list --linked    # see what prod already has
supabase db push --linked           # apply new migrations to prod
supabase migration list --linked    # confirm the new version is now applied
```

Before pushing, **confirm you are linked to the correct project**
(`qwvlzcqmicedxhfafiar` is production). Migrations must be additive and reversible.
If a migration cannot be safely rolled back, **stop** and reconsider.

---

## 3. Deploy

```bash
git push                            # share the code (does NOT deploy)
npx vercel --prod --yes             # this is what actually deploys
npm run playwright:hosted           # smoke-test the live alias
npm run release:report              # types/lint/unit/build/drift/hosted-smoke -> PASS/FAIL
```

Record the production deployment id printed by `vercel --prod`. Do not consider the
release done until the hosted smoke and the release report both pass.

---

## 4. Rollback

If the live site is broken after a deploy:

1. **Identify the last good deployment**
   ```bash
   npx vercel ls plaicetomeat-ops          # list recent deployments
   ```
   Pick the previous known-good production deployment id/URL.

2. **Redeploy the previous build** (promote it back to production)
   ```bash
   npx vercel promote <previous-deployment-url> --yes
   ```
   (Or re-run `npx vercel --prod` from the last good commit.)

3. **Failed migration:** if a migration caused the problem, do not blindly push more.
   - If it was additive and unused by old code, the previous build is usually safe to
     run against the new schema — roll the code back first (above).
   - If the schema change is incompatible, write and apply a corrective migration; do
     not edit an already-applied migration file in place.

4. **Stop the release** if a migration is not reversible and the deploy is bad — keep
   the previous build live and fix forward in a new migration.

---

## 5. Hard rules

- `git push` alone does **not** deploy. You must run `vercel --prod`.
- Database migrations are **not** automatic. You must run `supabase db push --linked`.
- Never push DB changes blindly — confirm the linked project is production first.
- Never deploy with a failing hosted smoke or a failing release report.
- Never deploy with checkout test mode exposed (`NEXT_PUBLIC_CHECKOUT_TEST_MODE` /
  `CHECKOUT_TEST_MODE_ENABLED` must be unset/false in production).
- Never weaken or skip tests to get a green run.
- Keep a known-good deployment id written down before every deploy so rollback is fast.
