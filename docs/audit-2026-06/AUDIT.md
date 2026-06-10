# PlaiceToMeat — Brutal Butcher's Audit (2026-06-08)

**Method:** logged in as owner on a local copy with real seed data, walked every screen (31 screenshots in `./screens/`), drove the counter, probed the database, and tried to break things. Judged as **the man behind the counter** — your dad — not as a developer.

**One-line verdict:** This is genuinely good — better and *kinder* than 90% of butcher/POS software. The bones are excellent. But three embarrassing surface bugs and **one foundational hole** stop it being the "god mode" tool it's one push away from being.

---

## 🩸 The brutal bit first — what's actually broken

### 1. The main "Start" button is INVISIBLE 🔴🔴
On the home screen (`/admin/today`), the big green banner says *"8 things need you today — about 15 minutes"* and the button next to it — **"Walk me through it"**, the single most important button in the whole app — is rendered **white text on a white background**. Your dad sees a blank white pill. The one button designed to lead him by the hand is the one he can't read.
- **Proof:** computed style `color: rgb(255,255,255)` on `background: rgb(255,255,255)`, 222×48px.
- Every *other* green button (e.g. "Start stock count", "Confirm stock") is correct green-on-white — so this is a one-line CSS slip, not systemic.
- **Fix:** one style change. Highest impact-to-effort in the whole audit.

### 2. "Received 3142 min ago" 🔴
On the Counter, older orders read *"Overdue — Received 3142 min ago"* and *"3495 min ago."* Nobody thinks in 3,142 minutes. It should say *"2 days ago."* Small, but it makes the tool look amateur on the busiest screen.
- **Fix:** roll minutes up into hours/days past 90 minutes.

### 3. "Expiring within 0 days" 🔴
A decision card reads *"Chicken Breast Fillets has 18.500kg expiring within 0 days."* "0 days" means **today** — so say **"today."** "Within 0 days" is robot-speak in an app whose whole personality is plain English.

### 4. **Selling meat does not change your stock** 🔴🔴🔴 (the big one)
This is the foundational hole. I sold a real order through the counter and measured it:
- **Before:** order PTM-2026-90003 = "1 kg Chicken Breast Fillets", stock = **45.2 kg**, lifetime SALE movements = **0**.
- I clicked **Collected** (the sale completed).
- **After:** order = "collected", stock = **45.2 kg (unchanged)**, SALE movements = **still 0**.

A full kilo of chicken left the building and the system's stock didn't flinch. Today, stock only moves when your dad *manually* counts, adds intake, or records waste. That means:
- "Running low" / "expiring soon" / "what should I order" are all built on a number that **drifts further from reality every single sale.**
- The smarter the dashboards look, the more dangerous this is — they're confidently advising off a stale number.

This is precisely what the **V14 Inventory Truth Engine** (already designed in `docs/v14/`) fixes. Until it ships, treat every stock number as "last count, minus guesswork."

---

## 🟠 Dad-friction — not bugs, but they tax him

| # | Issue | Why it hurts your dad | Simple fix |
|---|-------|----------------------|------------|
| 5 | **Shop nav bolted onto the back office.** Every admin page's top bar shows customer links — *Shop, Halal Promise, Basket* — mixed with *Counter, Food safety, Today, Business Insights.* | He doesn't shop his own counter. Customer links are noise that can misdirect a tap mid-service. | Hide the customer storefront nav when a staff member is logged in; show only his tools. |
| 6 | **24 admin "doors."** There are 24 distinct `/admin/*` routes. TODAY's tile grid helps, but the surface is large for one non-technical person. | Choice paralysis; he'll use 4 screens and fear the rest. | Lean harder on TODAY as the *only* front door; demote rarely-used screens (releases, audit, validation) into a clearly-labelled "Advanced / owner only" drawer. |
| 7 | **Decision cards advise but don't act.** The expiring-chicken card says *"Create a short-dated offer, add to a bundle, or prioritise prep"* — but offers only "Back to today" and a how-to article. No button does the thing. | He reads great advice, then has to go find where to act on it — so he often won't. | Put the action ON the card: a one-tap **"Mark 20% off today"** / **"Hide from shop."** Advice that acts = god mode. |
| 8 | **Junk/test products + missing photos** leak into the live shop ("V6.4 Intake Lamb Leg 1780743…", grey placeholder images). | Customers judge with their eyes; a photo-less, code-named product doesn't sell. | Curate the catalogue; require a photo before a product can go live. (Partly seed-data, but the "More" dumping ground and no-image state are real.) |

---

## 🟢 What's genuinely excellent — protect this, it's your moat

Being brutal cuts both ways. This app does things most £20k EPOS systems don't:

- **TODAY / Owner Brain** (`/admin/today`): Urgent / Important / Opportunities, each with a **money number** and a plain-English consequence (*"Could stop you selling that meat — and risks customer trust"*). This is the product. It's brilliant.
- **Decision cards** with *WHAT HAPPENED / WHY IT MATTERS / £92.50 at risk / RECOMMENDED ACTION.* Reads like a smart manager whispering in his ear.
- **Guided Open / Close / Stock count**: one step at a time, progress bar, real reasons (*"Meat must stay cold to be safe to sell"*). Genuinely dad-proof.
- **Counter kanban** (Incoming → Prepping → Ready → Collected): big coloured buttons, live updates, *"Call the customer — no real text was sent"* honesty. Excellent.
- **Purchasing "What should I order?"** with a data-quality score and a pre-order checklist. Decision support, not a spreadsheet.
- **Plain English everywhere.** *"Count what's really there — keep the system honest so 'running low' can be trusted."* Whoever wrote this copy understood the user.
- **Under the hood:** no client errors on any page; the security boundary holds (non-owners bounce to /unauthorised); audit log is append-only and un-forgeable; checkout/inventory are hardened against the usual concurrency/injection tricks (V11/V12 work). I tried the cheap breaks; they're closed.

---

## 🔓 Attempt-to-break — results

| Attack / probe | Result |
|----------------|--------|
| Sell an order, watch stock | **BROKE (by design gap):** stock unchanged, no SALE movement. → V14. |
| Client-side errors across all 28 screens | None. Stable. |
| Reach `/admin` as non-owner | Correctly blocked → /unauthorised (verified in middleware). |
| Forge audit rows / direct table writes | Blocked (append-only + revoked grants, V11.2). |
| Oversell / negative stock / stale count via RPC | Guarded (CHECK + FOR UPDATE + stale-count guard, V12.5) — reasoned from code. |
| Primary CTA usability | **BROKE:** invisible button (#1). |
| Time display on old orders | **BROKE:** "3142 min ago" (#2). |

The *security* is strong. The *truthfulness of the numbers* and a few *surface details* are the weak points.

---

## 🚀 GOD MODE — simple moves, ranked by (impact ÷ effort)

Each of these stays dead-simple for your dad. None add screens; most *remove* friction.

**Do this week (tiny effort, embarrassing if left):**
1. Fix the invisible "Walk me through it" button. *(1 line)*
2. "3142 min ago" → "2 days ago". *(tiny)*
3. "expiring within 0 days" → "expiring today". *(tiny)*
4. Hide customer shop nav when staff are logged in. *(small)*

**The transformation (medium effort, this is the god-mode leap):**
5. **Ship V14 so sales move stock.** The moment a "Collected" tap depletes the batch, *every* number becomes trustworthy and live. This is the difference between "smart-looking" and "actually smart." Already architected in `docs/v14/`.
6. **Make decision cards DO the action.** One tap on the card: "Mark 20% off today", "Add to bundle", "Hide from shop", "Reorder this". Advice → action in one thumb press.
7. **The one morning number.** Top of TODAY, before anything else: *"Yesterday you made £X profit on £Y sales. Today: Z orders, £W in the till."* One glance, he knows if it's a good day. (V14's cost-of-goods makes profit real.)

**The flourish (later, high delight):**
8. **"Text my customer" that actually sends.** The counter already admits *"no real text was sent."* Wiring real SMS on "Ready" is a visible, customer-delighting win.
9. **Waste → money story.** "This week you binned £64. FEFO would've saved ~£40." Turns the (V14) waste data into a habit-changing nudge.
10. **End-of-day one-pager.** Auto "Today in 20 seconds": sold, made, binned, low-stock-for-tomorrow, one thing to do. Print or text it to him.

---

## Bottom line for your dad

He already has a tool that *talks like a person* and *guides him by the hand*. Fix the four small embarrassments this week, then ship V14 so the numbers stop lying — and put the action *on* the advice cards. Do that and this stops being "nice software" and becomes the thing that quietly runs the shop better than a £40k manager would. That's the god-mode advantage, and you're closer to it than you think.

*Screens: `docs/audit-2026-06/screens/` (31 PNGs, desktop + mobile). Probe scripts: `scripts/audit-screens.mjs`, `scripts/audit-probe.mjs`.*
