# PlaiceToMeat — Strategy, Audit & Brutally Honest Assessment

_Date: 2026-06-03 · Audience: the owner (non-technical, no butcher experience) and the one technical helper · Launch target: ~Aug 2026_

> This document is deliberately blunt. It is written **from your point of view** — someone who
> cannot read the code, has never run a butcher's shop, and is about to put their dad behind the
> counter relying on this software. Where something is genuinely good, it says so. Where something
> could embarrass you, lose money, or stop you opening, it says that louder.

---

## 1. The one-paragraph verdict

You have built something **genuinely impressive and, in places, better than commercial butcher
software** — especially the honest money/margin philosophy and the counter screen. But you have a
**capability mismatch**: the analytics are built for an experienced data-driven operator, while the
actual operator is a first-time, non-technical butcher. The shop is **not yet safe to open** — not
because of features, but because of a short list of boring security/setup jobs that keep getting
skipped. And **nobody who actually knows butchery has checked the numbers the app confidently shows**.
Fix those three things (capability fit, launch safety, butcher sign-off) and you have a real product.

**Status traffic light:**
- 🟢 Engineering quality & data honesty
- 🟡 Owner usability / "can dad actually run this"
- 🔴 Launch safety (security + real-data setup)
- 🔴 Real-world butchery validation

---

## 2. What is genuinely good (don't lose these)

These are real strengths. Protect them as you change things.

1. **The "honest by design" data philosophy.** The app refuses to invent numbers. When it can't work
   out a margin it says _"Margin unavailable"_ instead of guessing. Costs are blended from real
   intake, never faked per-cut. This is rare even in paid software and it's the right call — it means
   your dad can trust what he sees.
2. **The counter screen is excellent.** Plain English, big buttons (Start Prep / Mark Ready /
   Collected), colour-coded urgency, tap-to-call, and — critically — **it cannot lose an order** even
   if texts fail or live updates drop. This is the screen the business runs on and it's the most
   finished part of the app.
3. **Halal & food-safety certificate tracking with 30-day expiry warnings.** This is a genuine
   differentiator and directly backs the halal promise to customers. Most shops track this on paper.
4. **Pay-on-collection only.** Smart scoping — no card payments means no PCI/refund/chargeback
   complexity to get wrong at launch. Keep it this way for v1.
5. **Seasonal "big day" advisor is honest.** It counts down to Eid/Ramadan/Christmas and explicitly
   flags Islamic dates as _"estimated — confirm locally"_ because of moon sighting. Honest and useful.
6. **Strong engineering foundations.** 137 passing unit tests, audit logging of every change,
   database-enforced permissions, idempotency keys (so a double-tap can't create duplicate stock),
   graceful fallbacks. The plumbing is solid.

---

## 3. The brutal assessment, area by area

### 3.1 Customer-facing shop — 🟡 "looks real, partly isn't"

- **🔴 The homepage shows fake products.** The landing page (`src/app/page.tsx`) lists demo items
  ("Chicken Breast Fillets") with the generic line _"Ready for pickup windows today"_, pulled from
  hardcoded demo data — **not** from your real product list. The `/shop` page _is_ wired to real data,
  so a customer sees real products on Shop but placeholder ones on the front page. That's the first
  thing a customer sees.
- **🟡 The shop name & address in the top bar are hardcoded** ("PlaiceToMeat Wylde Green / 426
  Birmingham Road") in `site-header.tsx`, not read from your editable shop settings. If those happen to
  be correct, fine — but you can't change them from the admin screens, only a developer can.
- **🟡 "Open counter dashboard" button sits on the public homepage.** Customers don't need a staff
  link advertised to them. It's locked behind login, but it's confusing clutter.
- **🟢 Checkout, basket, product pages, and price calculation are real and safe.** Prices are always
  recomputed on the server — a customer cannot tamper with what they're charged.

### 3.2 Owner dashboard — 🟡 "built for an analyst, used by a beginner"

This is the screen you most need to fix for adoption. It is **information-dense to the point of
overwhelm** for a non-technical owner.

- **Too many sections doing similar jobs.** On one screen there is: _"What needs attention?"_,
  _"Today's Focus"_, _"What happened today?"_, _"What needs fixing?"_, _"Where do I go next?"_,
  _"What should I watch?"_ (which alone holds **nine** sub-panels), and _"More tools"_. _"What needs
  attention?"_ and _"What needs fixing?"_ are nearly the same idea. Your dad will not read all of this.
- **Two panels with almost the same name.** _"What money can I make?"_ and _"What makes me money?"_
  sit next to each other and both show margin/profit. Confusing.
- **Nine "Business Insights" panels are mostly for later.** Customer loyalty, basket pairings, product
  performance, repeat-customer rate — these are powerful for a seasoned operator tuning a running
  business. On day one they're empty or thin, and empty analytics make the app feel broken.
- **Small but real polish leaks:**
  - Priority-action badges show the raw word **`info` / `warning` / `urgent`** as the label.
  - A "Desktop ready" badge sits in the header — meaningless to an owner.
  - When cost data is missing it prints **"Margin unavailable - no cost source available."** — that
    "no cost source" is developer language.
  - A panel summary reads **"_N_ forecast rows"** — "forecast rows" is jargon.
- **Recommendation:** ship a true **"Dad mode"** default — _Today's 3 things → today's numbers (5 max)
  → big buttons_. Put everything else behind a single "More detail / Business insights" tap. You
  already have the pieces; this is re-arrangement, not new features.

### 3.3 Staff / counter experience — 🟢 with two nits

- **🟢 Strong, as covered above.**
- **🟡 The "due" label is inaccurate.** An order due in 45 minutes still says **"Due in 15 min"**
  (anything within an hour shows the same text). Easy fix, but staff will notice it's wrong and trust
  it less.
- **🟡 Minor raw wording**: the little timestamp line shows "prepping 5 min ago" / "ready 2 min ago"
  using the internal status words. Readable, but could be friendlier.

### 3.4 Pricing & butchery tools — 🟡 "authoritative-looking, unverified"

- **🔴 The biggest risk in the whole app: nobody with butchery experience has checked the numbers.**
  The carcass calculator confidently tells your dad the "real meat cost" and a recommended price for
  every cut, based on yield percentages in `cut-sheets.ts`. If those yields are even moderately wrong,
  your dad will **systematically mis-price** — and neither of you has the experience to spot it. An
  authoritative-looking wrong number is worse than no number.
- **🟢 The honesty model underneath is right** (blended real cost, "don't price at carcass rate"
  warning, no fake per-cut costs). The _engine_ is trustworthy; the _input data_ (yields) needs a real
  butcher to sign off.
- **🟡 The pricing area has had a lot of churn** (V6.1→V6.6 in days, and this very session merged two
  divergent versions of the calculator). It works and is tested, but it's the least settled part of
  the app — treat new changes here with extra care.

### 3.5 Language & voice — 🟢 mostly excellent, slightly inconsistent

- **🟢 A real de-jargon effort has been done and it shows.** Most owner/staff copy is plain English
  ("What's going off soon", "Where money's being lost"). The owner guide is genuinely readable.
- **🟡 Voice drifts between plain-English questions and Title-Case labels.** Some panels are
  _"What expires soon?"_ while neighbours are _"Customer Loyalty"_, _"Product Performance"_, _"What
  Customers Buy Together"_. Pick one voice (recommend the plain-English question style) and apply it
  everywhere.
- **🟡 A handful of raw enum/dev words still surface** (the `info`/`warning` badges, "no cost source",
  "forecast rows", raw role badge `· owner`). Small, but they're exactly what a non-technical owner
  notices and worries about.

### 3.6 Security & launch safety — 🔴 this is what's actually stopping you

None of these are hard. They are skipped because they're boring. They are also non-negotiable.

- **🔴 The temporary owner back-door login still exists.** A `vtecoding@gmail.com` owner account was
  used to bootstrap. Per your own go-live checklist it must be removed or reset to a password only the
  owner controls before real customers arrive. _Right now it's a back door._
- **🔴 Test/seed accounts must not exist on the live database** (`owner@ptm.test`, `staff@ptm.test`,
  etc.). Verify and delete on prod.
- **🔴 Password-reset emails may go to the wrong place.** Memory flags the Supabase Auth "Site URL"
  still pointing at a stale domain (`...-iota.vercel.app`). Until fixed, "forgot password" can send
  your dad to a dead link.
- **🟡 No security review has been run on the final merged branch.** You have a `/security-review` tool;
  it hasn't been run on what's now live.
- **🟡 Idle logout / route lock-down** are claimed by tests but should be physically tried on the real
  shop tablet.

### 3.7 Process, deployment & "bus factor" — 🔴 fragile

- **🔴 `git push` does not deploy anything.** Production only updates when someone runs `vercel --prod`
  manually, and database changes only land when someone runs `supabase db push` manually. **This
  session is living proof of the danger:** a whole feature (V6.4) was live in production but had never
  been merged back into `main`, and two more were stacked on top of the gap. That kind of drift is
  invited by a manual, undocumented release flow.
- **🔴 Bus factor of one.** Everything technical — deploys, migrations, the temp-login removal, the
  Supabase config — depends entirely on you. If you're unavailable, your dad cannot get help from the
  software itself. Write the release steps down (see plan) and keep a known-good rollback.
- **🟡 The existing "UI audit" gives false confidence.** `audit/playwright-ui-audit*.md` only checks
  that pages return HTTP 200 — i.e. "the page didn't crash". It does **not** check that the workflow is
  correct or the words make sense. Don't read "all flows passed" as "the app is good".

### 3.8 Data-adoption risk — 🔴 the quiet killer

This is the deepest strategic risk and it's easy to miss.

**Almost every valuable feature depends on the owner diligently entering data that the owner won't
enter.** Margin, waste analysis, purchasing recommendations, depletion/"running low" forecasts — all
require your dad to log every intake (weights + costs), every binned item, and every product cost,
every day. The owner guide itself calls stock/waste **"optional"**. A busy, non-technical, first-time
butcher will not keep this up. The result: the headline features show "Margin unavailable", "No waste
recorded", thin or no recommendations — and your dad concludes _"this app doesn't really do
anything"_ and stops opening it.

**You must choose a path:**
- (a) make the app genuinely valuable with **near-zero daily input** (e.g. orders + a weekly 5-minute
  stock count), and/or
- (b) make data entry so fast and habitual (the carcass intake → stock flow is a good start) that it
  survives a real shop day.

Decide this before launch, because it determines whether the analytics half of the product is real or
decorative.

---

## 4. Strategic risks, ranked

1. **Unverified butchery numbers** → systematic mis-pricing, lost margin, eroded trust. _(§3.4)_
2. **Launch-safety jobs undone** → can't responsibly open; data/security exposure. _(§3.6)_
3. **Data-adoption gap** → the expensive analytics sit empty; app feels hollow. _(§3.8)_
4. **Owner-dashboard overload** → your dad avoids the screen that's meant to run his day. _(§3.2)_
5. **Manual, single-person release process** → drift, mistakes, no fallback. _(§3.7)_
6. **Demo data on the storefront** → unprofessional first impression. _(§3.1)_

---

## 5. The plan

### P0 — Launch blockers (must be done before a real customer arrives)

- [ ] **Remove/rotate the temp `vtecoding@gmail.com` owner login.** _(§3.6)_
- [ ] **Delete all `*.test` seed accounts from the production database.** _(§3.6)_
- [ ] **Fix the Supabase Auth Site URL & redirect URLs** to `https://plaicetomeat-ops.vercel.app` so
      password resets work. _(§3.6)_
- [ ] **Run `/security-review` on the current `main`** and fix anything it raises. _(§3.6)_
- [ ] **Replace homepage demo products with real catalog data**, and make the header shop
      name/address read from real settings (or at minimum confirm the hardcoded values are correct).
      _(§3.1)_
- [ ] **Get a real butcher to sanity-check `cut-sheets.ts` yields and three or four calculated
      prices** against what they'd actually charge. _(§3.4)_
- [ ] **Do a full real dry-run on the actual shop tablet**: place → prep → ready → collect → cancel,
      and confirm a closed-day/closed-slot order is impossible. _(go-live checklist §"Prove it works")_
- [ ] **Write down the release & rollback steps** (deploy, migrate, roll back) so it's not all in your
      head. _(§3.7)_

### P1 — Pre-launch polish (do these in the weeks before, in this order)

- [ ] **"Dad mode" dashboard default**: Today's 3 things → ≤5 numbers → big buttons; everything else
      behind one "More detail" tap. Merge the duplicate "attention/fixing" and "make money" sections.
      _(§3.2)_
- [ ] **Fix the visible wording leaks**: friendly labels instead of `info`/`warning`/`urgent`; drop
      "Desktop ready"; reword "Margin unavailable - no cost source available" and "forecast rows";
      hide the raw role badge. _(§3.2, §3.5)_
- [ ] **Fix the counter "Due in 15 min" label** to reflect the real time remaining. _(§3.3)_
- [ ] **Pick one voice** (plain-English questions) and apply across all panel titles. _(§3.5)_
- [ ] **Decide and implement the data-adoption path** (near-zero-input value vs. fast-entry habit).
      _(§3.8)_
- [ ] **Train your dad**: one real morning-dashboard walk-through + one counter shift on the tablet.

### P2 — After launch (only once the above is real and stable)

- [ ] Turn on SMS (Twilio) once you've watched orders flow without it for a week.
- [ ] Re-introduce the deeper analytics (loyalty, basket pairings, product performance) **gradually**,
      once there's enough real data to make them non-empty.
- [ ] Consider deposits for big Eid pre-orders (needs payments — a real project, not a tweak).
- [ ] Add lightweight CI so tests run automatically and reduce the manual-release risk.
- [ ] Extend the seasonal calendar each year (it's hardcoded through 2028).

---

## 6. Decisions only you can make

1. **Data-adoption strategy** (§3.8) — near-zero-input value, or fast-entry habit, or both? This
   shapes the whole analytics half of the product.
2. **How much dashboard does dad see on day one?** Recommend: very little, with everything one tap
   away. Confirm you agree before I rebuild it.
3. **Who is the butcher reviewer** for the yield/pricing numbers, and when can they look?
4. **Launch gate** — agree that the P0 list is genuinely mandatory and nothing opens until it's all
   ticked.

---

## 7. Bottom line

The software is not the problem — it's ahead of where it needs to be on features and well ahead on
engineering honesty. The risks are all at the **edges**: the boring launch-safety jobs, the unverified
real-world numbers, the question of whether a beginner will actually feed and use the clever parts, and
a release process that depends entirely on one person. Close those, simplify what your dad sees on day
one, and you're genuinely ready to open.
