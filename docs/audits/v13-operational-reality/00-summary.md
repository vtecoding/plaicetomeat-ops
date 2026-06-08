# 00 — V13 Operational Reality Audit — Summary

_PlaiceToMeat Ops · 2026-06-08 · audit-only, no application code changed._
_Audited at HEAD `fb9985c` (system maturity ≈ V11.3)._

> **Important scope caveat.** The audit brief refers to "V12 completion," a "V13.1 discovery
> report," and a "pricing validation/signoff report." **None of these artefacts exist in the
> repository.** The newest material is the V11.3 consolidation. This pack therefore audits the
> *actual* system that exists, and records the missing V12/V13 inputs as a documented gap
> (`08` §F). Do not assume a V12/V13 state that the code does not show.

---

## Overall verdict

PlaiceToMeat Ops is a **genuinely well-engineered system whose transaction core is excellent
and whose intelligence layer over-promises on data the shop won't reliably feed.** The parts
that take money and run the counter are safe, idempotent, audited, and plainly worded — better
than much commercial butcher software. The danger is concentrated in four "smart" features that
present **confident numbers built on incomplete data**: SMS that never sends, stock that never
decrements, depletion/purchasing advice built on that undepleted stock, and carcass prices from
unverified yields.

The right move for V13 is **not more features — it is honesty and closure.** Make the existing
capabilities tell the truth, then stop. The single highest-leverage realisation: **inventory is
never reduced by sales**, so every stock-derived insight is structurally optimistic until a
manual count. Fix the *honesty* of that now; fix the *mechanism* (sales-decrement) only in V14.

---

## Scores (out of 10)

| Dimension | Score | One-line justification |
|-----------|-------|------------------------|
| **System maturity** | **7/10** | Rich, tested, consolidated (V11.3), sealed audit, strong RLS — but SMS stubbed and stock-truth incomplete. |
| **Owner usability** | **6/10** | Today/Counter are genuinely good and plain-English; undermined by noisy analytics, dead routes, and figures the owner can't fully trust. |
| **Commercial intelligence** | **4/10** | The intelligence that exists is largely Dangerous or Decorative today (purchasing, depletion, loyalty); the truly useful signals (waste, certs) are under-surfaced. |
| **Operational risk** | **5/10** (moderate; 10 = safe) | Transaction paths well-locked and audited; risk sits in silent stock drift, unmet SMS promise, and missing-cert blindness. |

---

## Top 10 fixes

1. **Tell the truth about SMS** — wire it and test, or remove the "we'll text you" promise + add a counter "call the customer" cue. *(R7 / REC-1)*
2. **Stamp stock as intake-only + "last counted N days ago"** everywhere it's shown. *(R1 / REC-2)*
3. **Demote/gate depletion & purchasing recommendations** (false denominator). *(R2 / REC-3)*
4. **Add a "supplier has no certificate on file" nag** distinct from "expiring." *(R6 / REC-4)*
5. **One stock-correction door** (stock-count authoritative). *(D1 / REC-5)*
6. **Get a butcher to sign off carcass yields**; record the date; label prices "estimate." *(R8 / REC-12)*
7. **Single temperature source** so the legal `compliance_readings` can't stay empty. *(D2 / REC-6)*
8. **Idempotency on waste/adjust + graceful repeat-cancel.** *(R3 / REC-7)*
9. **Fix the "Due in 15 min" counter label** + merge the two help surfaces. *(REC-8/9)*
10. **Collapse Business Insights to a 3-truth weekly digest; move releases off owner nav.** *(REC-10/11)*

## Top 5 things NOT to build yet

1. **Sales-linked inventory decrement** — necessary eventually, but a correctness-critical V14
   project that must ship with cancellation reversal; rushing it risks money. *(R10 / REC-13)*
2. **More analytics / dashboards / insights** — the system needs *fewer, truer* signals. *(R12/R13)*
3. **Loyalty / CRM expansion** — no customer entity and no working comms channel yet. *(REC-14)*
4. **Online payments / deposits / refunds** — keep pay-on-collection for V1.
5. **Multi-branch features** — single-branch isolation is sound but unproven in anger. *(R5)*

## Do-not-touch (protects correctness, money, auditability)

Checkout idempotency · order state machine (`FOR UPDATE`) · sealed append-only audit
(`audit_logs`/`audit_events`, V11.2) · RLS/branch isolation. *(R5, R14)*

---

## Recommended next step

**Proceed to V13.2 = "make the app honest" (see `10-v13-roadmap.md`):** the six small, high-
confidence changes that remove every Dangerous/false-confidence behaviour — SMS truth, stock
honesty stamp, demote purchasing, no-cert nag, one correction door, yield sign-off. Treat those
as the bar for **V13 close**. Defer the real stock-decrement work to a carefully-designed V14.
Build nothing new beyond this list.

Before any of that, the owner should resolve the **Unknowns** (`08` §F): confirm whether the
missing V12/V13/pricing-signoff artefacts exist elsewhere, verify the launch-safety env items
(temp login, test accounts, Supabase Site-URL), and confirm the homepage now shows real data.

---

## Audit pack contents

| File | Purpose |
|------|---------|
| `00-summary.md` | This summary (verdict, scores, top fixes). |
| `01-page-usage-audit.md` | Every route: user, frequency, decision, verdict. |
| `02-workflow-audit.md` | 16 workflows scored /10 with failure/race/duplicate analysis. |
| `03-duplicate-capability-audit.md` | Overlaps; valid vs harmful; consolidation. |
| `04-commercial-value-audit.md` | Capabilities ranked Critical→Dangerous. |
| `05-owner-daily-journey.md` | Ideal day vs what the system answers. |
| `06-data-to-decision-map.md` | Every data source → decision (or bloat). |
| `07-failure-modes-and-risk-register.md` | R1–R14 risk register with severity/mitigation. |
| `08-v13-findings.md` | Findings by category (must-fix → unknowns). |
| `09-v13-recommendations.md` | 14 ranked recommendations with targets. |
| `10-v13-roadmap.md` | V13.2 / V13.3 / V14 + explicit non-goals. |

_Method: repository read at HEAD, schema/migrations, server actions + RPCs, page inventory,
and existing docs (STRATEGY-AND-AUDIT-2026-06, V8/V9 specs, V11.3 consolidation, UX-friction).
No application code, migrations, or config were modified._
