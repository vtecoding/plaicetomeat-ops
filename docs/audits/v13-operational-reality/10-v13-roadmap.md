# 10 — V13 Roadmap

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

Principle: **closure, simplification, insight, owner-workflow clarity** — not feature
expansion. The system is already feature-rich beyond its operator. The job now is to make
what exists **honest, trusted, and quiet.**

---

## V13.2 — Highest-confidence slice (do only this next)

The theme is **"stop the app from lying."** Small, high-confidence changes that remove
Dangerous confidence and unmet promises. No new capability surface.

1. **REC-1 — SMS truth.** De-promise the "we'll text you" copy (or wire+test Twilio) and add
   an owner alert when ready-SMS isn't actually going out. *(R7)*
2. **REC-2 — Stock honesty stamp.** "Intake-only · last counted N days ago" everywhere stock
   shows; Today nudge when stale. *(R1)*
3. **REC-3 — Demote depletion/purchasing** off the daily surface (or gate behind a recent
   count); reframe to "sold vs wasted — you decide." *(R2)*
4. **REC-4 — "No certificate on file" nag** for suppliers. *(R6)*
5. **REC-5 — One stock-correction door** (stock-count authoritative; adjust = labelled
   exception). *(D1)*
6. **REC-12 — Butcher yield sign-off** (owner action; record sign-off date in-app). *(R8)*

**Exit criteria for V13.2 / "V13 close":** no feature presents confident numbers it can't
support; the SMS promise matches reality; halal-cert absence is visible; stock figures are
labelled honest; yields are signed off.

## V13.3 — Optional polish / hardening

Only after V13.2 is real and stable. Theme: **tidy and harden.**

- **REC-6** Single temperature source (finish V11.3b dedup). *(D2)*
- **REC-7** Idempotency on waste/adjust + graceful repeat-cancel. *(R3)*
- **REC-8** Accurate counter "due" label.
- **REC-9** Merge `/admin/guide` into playbooks; dry-run under setup.
- **REC-10** Releases off owner nav; carcass prices labelled "estimate."
- **REC-11** Collapse Business Insights to a 3-truth weekly digest; remove basket-pairing.
- Retire dead `mode=counter` branch; consider folding `/admin/today/walk` into day-shape.
- Verify pickup-window last-slot capacity under lock. *(R4)*

## V14 — Next major capability (only if justified by real usage)

Do **not** start these until the shop has run on V13.x and the owner is actually feeding data.

- **REC-13 — Sales-linked inventory decrement** (the real fix for R1/R2). Correctness-critical:
  `SALE` movement on collected, FEFO depletion, **paired cancellation/refund reversal (R10)**,
  full tests. This is what makes stock, depletion, and purchasing genuinely real — and only
  then should those features be re-promoted.
- **REC-14 — Real customer entity + one retention action** (needs working SMS first).

## Explicit non-goals (do NOT build in V13)

- ❌ No new analytics panels, dashboards, or "insights." (The opposite is needed.)
- ❌ No sales-decrement/forecasting in V13 — it's a V14 project, not a tweak (rushing it risks
  money correctness).
- ❌ No payments/deposits/refunds online (keep pay-on-collection for V1; STRATEGY §P2).
- ❌ No loyalty/CRM expansion until there's a customer entity *and* a working comms channel.
- ❌ No multi-branch rollout work (single-branch isolation unproven in anger; R5).
- ❌ No touching the sealed audit, RLS/branch isolation, checkout idempotency, or the order
  state machine except to *preserve* them. *(R5, R14)*
- ❌ No new carcass/pricing features until yields are signed off. *(R8)*

## One-line roadmap

> **V13.2: make the app honest. V13.3: make it tidy. V14: make stock real. Build nothing else.**
