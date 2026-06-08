# 05 — Owner Daily Operating Journey

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

The ideal day for a **busy halal butcher under pressure**, mapped against what the system
*actually* answers today. "Answered?" = ✅ yes / ⚠️ partly / ❌ no.

Design rule borrowed from V9: anything in the owner's face must answer *what happened, why it
matters, what to do, how much money* — or it shouldn't be there.

---

## Before opening (06:00–08:00)
**Needs to know:** Am I open today? Any orders to prep first thing? Anything expiring I must
sell/bin today? Any cert expired? Is the shop safe/clean to trade?

- **Page that should answer it:** `/admin/today` (day-shape + Urgent bucket) → `/admin/open` → opening temps.
- **Answered?** ⚠️ **Partly.**
  - ✅ Today's day-shape + urgent decisions, expiring-stock and cert warnings (if certs entered).
  - ⚠️ "Expiring today" leans on `remaining_weight_kg` which overstates stock (R1) — may flag stock that's actually gone.
  - ⚠️ Opening temperature double-capture (D2) — easy to log in the wrong place.
- **Missing:** a single "you're clear to open" confirmation; a "last stock count: N days ago" honesty line.
- **Automate/summarise:** one opening card — *open? ✓ · X orders to prep · Y items to sell today · certs OK · temps logged*.

## During morning trade (08:00–12:00)
**Needs to know:** What do I prep next? Who's collecting when? Did the customer get told it's
ready?

- **Page:** `/counter` (dad's screen).
- **Answered?** ✅ **Mostly yes** — strong board, can't-lose-an-order, tap-to-call.
  - ❌ "We'll text when ready" — **the text never sends (R7)**; staff/customer falsely assume it did.
  - ⚠️ "Due in 15 min" label inaccurate for >15-min windows.
- **Missing:** an honest "SMS is OFF — call the customer" cue on each card.
- **Automate:** if SMS stays off, replace the badge with a one-tap "call to say it's ready."

## Mid-day check (12:00–14:00)
**Needs to know:** How's today vs normal? Anything going wrong I should catch now (waste,
a stuck order, a slot overfilling)?

- **Page:** `/admin/today` (re-check) / `/admin` snapshot.
- **Answered?** ⚠️ **Partly.**
  - ✅ Orders-today, revenue-today, waste-this-week, certs.
  - ⚠️ Mid-day food-safety temperature reading exists but is optional and double-homed (D2).
  - ❌ No live "today vs a normal day" comparator that's trustworthy.
- **Missing:** a 10-second mid-day pulse the owner can glance at between customers.
- **Automate:** push the *single* most important exception, not a dashboard.

## Supplier / order decision time (the weekly buy)
**Needs to know:** What do I order, how much, from whom? What's selling fast / wasting?

- **Page:** `/admin/purchasing` (+ `/admin/inventory`, `/admin/compliance` for cert status).
- **Answered?** ⚠️/❌ **This is the weakest, most dangerous answer.**
  - The buy recommendation runs sales velocity against **undepleted stock (R2)** → confident but structurally wrong "order more/less."
  - Cert status for the supplier *is* available (good) but no "supplier with no cert" guard (R6).
- **Missing:** a buy list the owner can actually trust; it needs either sales-decrement (R1) or a "counted recently" gate.
- **Automate:** until R1/R2 fixed, demote auto-recommendations to "here's what sold and what you wasted — you decide," which is honest.

## Closing (17:00–19:00)
**Needs to know:** Did I capture today's waste and counts? Tills done? Anything for tomorrow?
Closing temps logged?

- **Page:** `/admin/close` (checklist + guided stock/waste) → closing temps.
- **Answered?** ✅ **Yes, if done** — the closing flow is genuinely good and is the main weapon
  against drift (R1).
  - ⚠️ It's optional; a busy night = skipped = stock stays wrong; temp double-capture (D2).
- **Missing:** a gentle "you've skipped closing capture 3 days running — stock is drifting" nudge.
- **Automate:** make stock/waste capture the fast default of closing, not an extra.

## End-of-day review (after close)
**Needs to know:** Did I make money today? What did I waste and what did it cost? Anything to
fix before tomorrow?

- **Page:** `/admin` snapshot + `/admin/today` weekly summary.
- **Answered?** ⚠️ **Partly.**
  - ✅ Revenue today, waste cost (when recorded), today's orders.
  - ⚠️ "Margin" honest-but-often-"unavailable" without full cost entry (by design — good honesty, weak experience).
- **Missing:** a one-line "today: £X in, ~£Y meat cost, £Z wasted, net feeling: good/ok/bad."
- **Automate:** an end-of-day receipt-style summary (5 numbers max).

## Weekly review (quiet morning)
**Needs to know:** Trends — best/worst sellers, waste patterns, repeat customers, certs due
soon, what to change.

- **Page:** `/admin` Business Insights (9 panels).
- **Answered?** ⚠️ **Over-answered and under-trusted.**
  - Lots of analytics, mostly thin/empty without data (R12/R13); loyalty fragile (no customer table); some panels non-actionable.
  - ✅ Cert-expiry-soon and waste-by-product are the genuinely useful weekly ones.
- **Missing:** focus. Three weekly truths beat nine panels.
- **Automate/summarise:** a weekly digest: *top seller, biggest waste, certs due in 30 days, one suggested change.*

---

## Journey scorecard

| Moment | Answered? | Biggest gap |
|--------|-----------|-------------|
| Before opening | ⚠️ partly | stock-truth honesty line; clear "open OK" |
| Morning trade | ✅ mostly | SMS promise unmet (R7) |
| Mid-day | ⚠️ partly | trustworthy 10-sec pulse |
| Order/buy time | ❌ weak/dangerous | buy advice on false data (R2) |
| Closing | ✅ if done | capture is skippable; drift nudge |
| End of day | ⚠️ partly | one-line money summary |
| Weekly | ⚠️ over-built | focus to 3 truths |

## What "good" looks like (the target journey)
1. **One opening card:** open? · orders to prep · sell-today list · certs OK · temps.
2. **Counter:** unchanged, but honest about SMS (call cue if off).
3. **One mid-day exception** pushed, not a dashboard.
4. **An honest buy view** ("sold vs wasted, you decide") until forecasts are trustworthy.
5. **Closing that captures truth fast** + drift nudge.
6. **End-of-day 5-number receipt.**
7. **Weekly 3-truth digest.**

Almost all of this is **re-arrangement and honesty**, not new engineering — the pieces exist.
The two real blockers to a clean journey are **R7 (SMS)** and **R1/R2 (stock truth)**.
