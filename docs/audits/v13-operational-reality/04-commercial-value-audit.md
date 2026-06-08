# 04 — Commercial Value Audit

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

Each major capability is rated on seven axes and given an overall verdict:
**Critical / High / Medium / Low / Decorative / Dangerous.**

> **Dangerous** = creates confidence without reliable data, hides failure, duplicates truth,
> or misleads the owner. A dangerous feature is worse than a missing one.

Impact axes: **Profit · Waste · Stock accuracy · Compliance · Retention · Owner time ·
Staff ease.** (H/M/L per axis.)

---

## Capability ratings

### Online ordering + checkout
- Profit **H** · Waste L · Stock L · Compliance L · Retention **H** · Owner-time **H** · Staff-ease **H**
- The revenue engine. Safe, idempotent, server-priced.
- **Verdict: CRITICAL.** Protect; do not destabilise.

### Counter fulfilment board
- Profit **H** (throughput) · Waste L · Stock L · Compliance L · Retention **H** (service) · Owner-time **H** · Staff-ease **H**
- Robust, can't-lose-an-order, plain English.
- **Verdict: CRITICAL.**

### Halal supplier certificate tracking (+ public promise page)
- Profit M · Waste L · Stock L · Compliance **H** · Retention **H** (trust = #1 differentiator) · Owner-time M · Staff-ease M
- Real differentiator most shops do on paper. **Weakness:** absence ≠ alert (R6).
- **Verdict: CRITICAL** (with the no-cert nag fix). Until then leans toward **Dangerous** because "all green" can mean "nothing entered."

### Order status transitions / audit trail / sealed audit
- Compliance **H** · everything-else via correctness.
- Protects money and auditability (R14).
- **Verdict: CRITICAL — do not touch.**

### TODAY / Owner Brain (decision compression)
- Profit M · Waste M · Stock M · Compliance M · Retention L · Owner-time **H** · Staff-ease **H**
- The thing that turns a database into an operating system; honest by design (caps, language firewall). Quality is capped by data honesty (R1/R2) and adoption (R12).
- **Verdict: HIGH** (Critical if R1/R2 honesty is added).

### Stock count / reconciliation
- Profit M · Waste **H** · Stock **H** · Compliance M · Owner-time L (costs time) · Staff-ease M
- The **only** control that corrects inventory drift (R1). Underused → everything stock-derived rots.
- **Verdict: HIGH** (structurally Critical, but only if actually run).

### Carcass intake + yield/cost engine
- Profit **H** · Waste M · Stock **H** · Compliance M (traceability) · Owner-time M · Staff-ease L
- Genuinely sophisticated, atomic, honest blended cost. **But** unverified yields (R8) make its *price recommendations* potentially **Dangerous** until a butcher signs off.
- **Verdict: HIGH (engine) / DANGEROUS (price output until signed off).**

### Waste recording
- Profit M · Waste **H** · Stock **H** · Compliance M · Owner-time L · Staff-ease M
- Drives waste analysis + true margin. Adoption-limited; non-idempotent (R3).
- **Verdict: HIGH** (when used).

### Stock receiving (non-carcass)
- Profit **H** (cost basis) · Stock **H** · others L
- Feeds all margin. Optional idempotency (R3).
- **Verdict: HIGH.**

### Daily food-safety compliance log
- Compliance **H** · others L
- Legal necessity; HMC-credible. Weakened by double-capture (D2).
- **Verdict: HIGH.**

### Pickup windows / shop closures / settings
- Owner-time M · Staff-ease M · Profit L
- Set-once plumbing that prevents bad orders (e.g. Eid closures).
- **Verdict: MEDIUM** (KEEP, cheap).

### Purchasing recommendations (order more/less)
- Claims Profit **H** + Waste **H**, but **built on the false depletion denominator (R2)**: sales velocity vs undepleted stock.
- **Verdict: DANGEROUS** today (confident buying advice from contradictory data). Becomes HIGH only after R1/R2. **Demote/gate now.**

### Inventory depletion / "days until runout"
- Same structural flaw as above (R2).
- **Verdict: DANGEROUS** until sales-decrement or a recent-count gate exists.

### SMS "we'll text when ready"
- Claims Retention **H** + Owner-time **H**; **reality: stub, never sends (R7)**, while customers are promised a text.
- **Verdict: DANGEROUS** (hides a failed promise behind an honest-but-buried log). Either wire it (→ HIGH) or remove the promise.

### Business Insights analytics (loyalty, basket pairings, product performance, profitability)
- Profit M (potential) · Retention M (potential) · Owner-time **negative** (noise) · Staff-ease L
- Analyst-grade; thin/empty without sustained data; mostly non-actionable now (R13). Loyalty matching is fragile (no customer table).
- **Verdict: LOW / DECORATIVE** today. DEFER until data exists and each panel yields one concrete action.

### Cutting/pricing guide (calculator)
- Profit **H** (potential) · Owner-time M · Staff-ease L
- Same yield-verification caveat as carcass engine.
- **Verdict: HIGH (gated on sign-off).**

### Playbooks / guide / setup checklist
- Owner-time M · Staff-ease **H** (onboarding) · Profit L
- Cheap, supports the real adoption risk.
- **Verdict: MEDIUM** (KEEP; MERGE the two help surfaces — D3).

### Releases / migration ledger
- No shop-operations impact; pure dev tooling on the owner's surface.
- **Verdict: DECORATIVE** (for the owner). Keep tables; hide from owner nav.

---

## Ranked verdict table

| Capability | Verdict | Note |
|------------|---------|------|
| Online ordering / checkout | **CRITICAL** | revenue engine |
| Counter fulfilment | **CRITICAL** | the shop runs on it |
| Halal cert tracking + promise | **CRITICAL** | #1 differentiator (fix R6) |
| Order audit trail / sealed audit | **CRITICAL** | do not touch |
| TODAY / Owner Brain | **HIGH** | the operating system |
| Stock count / reconciliation | **HIGH** | only fix for drift |
| Carcass intake engine | **HIGH** | atomic, honest cost |
| Waste recording | **HIGH** | true margin (when used) |
| Stock receiving | **HIGH** | cost basis |
| Food-safety log | **HIGH** | legal (fix D2) |
| Cutting/pricing guide | **HIGH** (gated) | needs sign-off |
| Pickup windows / closures / settings | **MEDIUM** | cheap plumbing |
| Playbooks / guide / setup | **MEDIUM** | adoption support |
| Business Insights analytics | **LOW / DECORATIVE** | defer until data |
| Releases ledger (owner view) | **DECORATIVE** | dev tooling |
| **Carcass price output (unsigned)** | **DANGEROUS** | mis-pricing (R8) |
| **Purchasing recommendations** | **DANGEROUS** | false denominator (R2) |
| **Depletion / runout forecast** | **DANGEROUS** | false denominator (R2) |
| **SMS ready-text** | **DANGEROUS** | unmet promise (R7) |

---

## The commercial story

The shop makes money on **four Critical capabilities** (ordering, counter, halal trust,
auditable correctness) — and those are the most finished, safest parts. Good.

The **danger is concentrated in the "intelligence" half**: purchasing, depletion, SMS, and
unsigned-off pricing all present confidence the underlying data can't support. For a busy,
non-technical owner this is the worst failure mode — he'll either trust a wrong number (lose
money) or notice it's wrong once and distrust the whole app.

**Commercial recommendation:** before building anything new, **demote or fix the four Dangerous
items.** Make the Critical four flawless, make the cert-trust feature nag on absence, and treat
the analytics half as *deferred* until the shop is actually feeding it data. Honesty is this
product's brand — every Dangerous feature spends that brand.
