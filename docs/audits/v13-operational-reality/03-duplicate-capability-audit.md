# 03 — Duplicate / Overlapping Capability Audit

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

V11.3 already did a "one door per job" consolidation
(`docs/v11/v11-3-consolidation-audit.md`). This report checks **what overlap remains** and
whether it is *valid* (same data, different audience/purpose) or *harmful* (two ways to do
one job, or two sources of one truth).

---

## D1 — Stock correction has two doors
- **Capability:** correct a batch's remaining weight.
- **Locations:** `/admin/inventory` per-batch "Correct stock" (owner-only) **and** `/admin/stock-count` apply-variance. Both ultimately call `admin_adjust_inventory_remaining`.
- **Valid or harmful?** **Harmful (mild).** Same RPC, two entry points; V11.3 tried to make stock-count the authority but left inventory adjust as an "owner exception."
- **Risk:** owner corrects in one place, count session in another → reconciliation confusion; two audit narratives for one truth.
- **Consolidation:** make `/admin/stock-count` the sole correction workflow; keep inventory adjust only as a clearly-labelled emergency exception (or remove it).
- **Gain:** one mental model for "make the number right"; cleaner audit story.

## D2 — Temperature captured in two rituals
- **Capability:** record chiller/freezer/display temps.
- **Locations:** `/counter/compliance` (official `compliance_readings`) **and** opening/closing checklists (`/admin/open`, `/admin/close` via ops_* steps).
- **Valid or harmful?** **Harmful.** Two capture surfaces for one legal record; V11.3b dedup explicitly deferred (`v11-3-consolidation-audit.md:104-107`).
- **Risk:** owner records temp in the checklist but the official `compliance_readings` stays empty → a food-safety inspection finds gaps despite diligent staff.
- **Consolidation:** opening/closing temperature step writes the official `compliance_readings`; compliance page reads the same record.
- **Gain:** single legal temperature truth; no double entry.

## D3 — Two help/training surfaces
- **Capability:** "how do I do X?"
- **Locations:** `/admin/playbooks` (+`[slug]`) and `/admin/guide` (6 quick cards + dry-run).
- **Valid or harmful?** **Mildly harmful** (split attention, two places to maintain copy).
- **Risk:** drift between the two; owner unsure which to read.
- **Consolidation:** **MERGE** quick cards into the playbooks index; keep the dry-run script under `/admin/setup`.
- **Gain:** one help home.

## D4 — Carcass pricing computed in two places
- **Capability:** turn a carcass into per-cut costs/prices.
- **Locations:** `/admin/cutting-guide` (CarcassCalculator) and the intake confirm path (`CarcassIntakeReview` → `admin_confirm_carcass_intake`).
- **Valid or harmful?** **Valid but adjacent.** The calculator is "plan/explore"; the intake review is "commit." Both lean on `cut-sheets.ts`.
- **Risk:** Low for correctness; some duplicated yield logic to keep in sync.
- **Consolidation:** keep both but ensure a **single** yield/cost engine (`carcass-breakdown.ts`) backs both (appears to be the case). No UI merge needed.
- **Gain:** none beyond confirming single engine.

## D5 — "What's in stock / running low" shown in 4 surfaces
- **Capability:** current stock + risk.
- **Locations:** `/admin/inventory` (batches), `/admin/purchasing` (depletion), `/admin/stock-count` (system vs counted), `/admin` panel ("what expires soon"/"stock at risk"), plus customer stock badges.
- **Valid or harmful?** **Mostly valid** (entry vs plan vs reconcile vs analysis vs customer) — **but** they all read the **same overstated `remaining_weight_kg`** (R1). The duplication isn't the danger; the *shared false denominator* is.
- **Risk:** five surfaces confidently repeating the same wrong number.
- **Consolidation:** don't merge surfaces; fix the source (R1/R2) or stamp every surface with "intake-only, last counted N days ago."
- **Gain:** consistency becomes *honesty*, not just tidiness.

## D6 — Order views in three places
- **Capability:** see orders.
- **Locations:** `/counter` (live fulfilment), `/admin/orders` (history/search), `/order/status/[id]` (customer).
- **Valid or harmful?** **Valid.** Different roles, different jobs, different data exposure (customer DTO redacts PII). V11.3 already reframed `/admin/orders` as history.
- **Risk:** Low.
- **Consolidation:** none. **KEEP all three.**

## D7 — Two audit surfaces (`audit_logs` vs `audit_events`)
- **Capability:** record who-did-what.
- **Locations:** `audit_logs` (system/SECURITY DEFINER) and `audit_events` (app-facing: actor email/role/IP), mirrored via `mirror_audit_log_to_event`.
- **Valid or harmful?** **Valid by design** — "what happened" vs "who/from where," both sealed append-only (V11.2).
- **Risk:** Low; tightly coupled, one mirror trigger. Protect, don't merge.
- **Consolidation:** none. **KEEP — do not touch (R14).**

## D8 — Cost basis in two columns
- **Capability:** product cost for margin.
- **Locations:** `inventory_batches.cost_per_kg` (authoritative, actual) and `products.cost_per_kg` (fallback).
- **Valid or harmful?** **Valid** — batch cost wins when present; product cost is a fallback for products with no batch.
- **Risk:** Low, *if* receiving always populates batch cost. Drift risk if fallback silently used.
- **Consolidation:** none; add a "using fallback cost" indicator where margin is shown.

## D9 — Order status truth (`orders.status` vs `order_status_events`)
- **Valid by design** — current state vs immutable history. **KEEP.**

## D10 — Operational "today" decisions (resolved overlap)
- V11.3 already merged `/admin/briefing` + `/admin` operational logic into `/admin/today`. Remaining residue: `/admin/today/walk` overlaps Today's day-shape, and `/admin?mode=counter` / `/admin/briefing` still *resolve* (redirect/fall-through).
- **Consolidation:** retire the dead `mode=counter` branch entirely; consider folding `walk` into day-shape. Low urgency.

---

## Summary

| ID | Overlap | Harmful? | Recommendation |
|----|---------|----------|----------------|
| D1 | Stock correction ×2 | Yes (mild) | MERGE into stock-count |
| D2 | Temperature capture ×2 | **Yes** | MERGE (finish V11.3b) |
| D3 | Help surfaces ×2 | Mild | MERGE guide→playbooks |
| D4 | Carcass pricing ×2 | No (valid) | Confirm single engine |
| D5 | Stock views ×4–5 | No — but shared false number | Fix source (R1/R2), not the views |
| D6 | Order views ×3 | No (valid) | KEEP |
| D7 | Audit surfaces ×2 | No (valid) | KEEP — do not touch |
| D8 | Cost columns ×2 | No (valid) | Add fallback indicator |
| D9 | Status vs events | No (valid) | KEEP |
| D10 | Today residue | Mild | Retire dead branches; maybe fold walk |

**Headline:** V11.3 did the heavy lifting. The two overlaps worth fixing are **D2 (temperature
double-capture — a real legal risk)** and **D1 (two stock-correction doors)**. The most
*dangerous* "duplication" is not really duplication at all — it's **D5**: many surfaces faithfully
repeating one structurally-wrong stock figure. Consolidating screens won't fix that; fixing the
data source (R1/R2) will. Everything else (audit, cost, order views) is valid separation —
**leave it alone.**
