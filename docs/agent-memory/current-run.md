# PTM Production Hardening Run — 2026-07-10 — COMPLETE

## Outcome
Diverged main reconciled with origin, six audit findings fixed, every validation tier
green (static 7/7, db 6/6, live 7/7, unit 620/620, lint, build, typecheck).

## Commits this run (local main, on top of merge base 91488cd)
1. `fe482c8` merge: reconcile pilot-candidate main with origin/main hardening line
2. `e85f2d0` fix: lock products + event tables to audited write paths (phase 3)  [N7]
3. `8296f22` fix: repair header-only serve orders on retry instead of collecting them  [N1]
4. `31eca30` fix: derive cost-pending visibility from batch state, not one alert write  [N2]
5. `112102b` test: add RLS-coverage guard; wire orphaned truth guards into the gate  [N3+N5]
6. `297d9bb` fix: correct the root error surface copy and recovery paths  [N4]
7. (docs commit) architecture doc + agent-memory docs

## Validation evidence (all on the final tree)
- `corepack pnpm typecheck` — PASS (0 errors)
- `corepack pnpm test` — PASS 620/620 (79 files; +9 new serve-repair/failure-surface tests)
- `corepack pnpm lint` — PASS (0 errors, 5 pre-existing warnings)
- `corepack pnpm build` — PASS
- `architecture:check` static — PASS 7/7 (now incl. rls-coverage + operational-truth)
- `architecture:check --tier=db` — PASS 6/6 (now incl. compliance-integrity 14/14;
  truth-table-lock extended to 12 adversarial checks incl. phase3 tables)
- `architecture:check --tier=live` vs next start :3001 + seeded local Supabase —
  PASS 7/7 (route-lock, journeys, action-compression, today-os, one-tap, briefing,
  win-back)
- Reconcile self-heal live probe — 3/3 PASS (cost-0 OP batch with deleted alert →
  alert recreated on tray read, batch visible, audited) — throwaway script, logic now
  covered by the fix itself
- Migration `202607101200` applied cleanly to local stack; fresh-DB order safe
  (policies it drops are created by earlier migrations; REVOKEs idempotent).

## Notes for the next run
- `.env.local` intentionally lacks CANONICAL_BRANCH_ID; set it in-process when
  running `next start` locally or /api/health returns 503 CONFIGURATION_REQUIRED.
- The two legacy guard scripts are now first-class constitution articles; don't
  re-orphan them when editing package.json / architecture-check.
- Remaining known risks live in §21 of docs/architecture/ptm-production-architecture.md
  and docs/agent-memory/known-risks.md.
