# Go-Live Checklist — PlaiceToMeat

Work top to bottom. Don't open to real customers until every **🔒 Security** and
**🛒 Shop data** box is ticked. Items marked **(tech)** are for the support
person; the rest the owner can check.

> **In-app helper:** the Owner Dashboard now has a **Launch Readiness** panel at the
> top that automatically checks the shop-data items below (products, prices,
> collection times, certificates, a test order, a staff account, text-message
> state) and shows **Ready / Needs attention / Not started**. It only ticks what it
> can actually verify — the security and "review it yourself" items on this list
> still need a human. Use the panel and this checklist together.

---

## 🔒 Security — do these first, no exceptions

- [ ] **Remove the temporary owner login.** Disable or delete the temporary
      `vtecoding@gmail.com` owner account in Supabase Auth, or reset it to a
      strong password the owner controls. It must not remain as a back door.
      *(README and release notes both call this out.)*
- [ ] **Owner & staff passwords are strong and private.** No shared/default
      passwords. Each staff member has their own login. **(tech)**
- [ ] **Deactivate test/seed accounts.** The dev seed users (`owner@ptm.test`,
      `staff@ptm.test`, etc.) must not exist on the live database. **(tech)**
- [ ] **Secrets are server-only and rotated.** `SUPABASE_SERVICE_ROLE_KEY` and any
      Twilio credentials live only in server environment variables, never in the
      browser bundle or git. Rotate any key that was ever pasted in chat/email. **(tech)**
- [ ] **Staff pages are locked down.** Confirm that signing out, or visiting
      `/admin` or `/counter` while logged out, redirects to login. Confirm a
      `staff` account cannot reach `/admin`. **(tech — covered by route-protection tests)**
- [ ] **Idle logout works.** Staff sessions time out after inactivity (4 hours).
      Verify by leaving a session idle. **(tech)**
- [ ] **Run a security review of the final branch** before deploy. **(tech)**

## 🛒 Shop data — the shop is only "real" once this is filled in

- [ ] **Products & prices** entered for everything you sell, with correct prices
      and units (each / per kg). No demo/placeholder items left.
- [ ] **Collection times** set to your real opening slots.
- [ ] **Closed days** added (weekly closures, holidays, Eid closures).
- [ ] **Supplier certificates** recorded with real expiry dates (this backs the
      halal promise).
- [ ] **Shop details** correct — name, address, phone shown to customers.
- [ ] **Halal Promise and Privacy pages** read and accurate for your shop. Don't
      claim a hygiene rating you don't hold.

## 📱 Text messages (optional — orders work without them)

- [ ] Decide: texts **on** or **off** at launch. Off is a perfectly safe start.
- [ ] If **on**: Twilio account funded, sender number verified, and the "order
      ready" message template checked. **(tech)**
- [ ] If **off**: confirm staff know to phone customers when an order is ready.
- [ ] Either way: a failed text never blocks an order — confirmed in the app.

## ✅ Prove it works (do a real dry run)

- [ ] Place a **real test order** from a phone, start to finish.
- [ ] Watch it appear on the **Counter** and move it Incoming → Prepping → Ready →
      Collected.
- [ ] Confirm the price the customer saw matches Products & Prices.
- [ ] Try to order a **closed day / turned-off slot** — it should be impossible.
- [ ] Cancel a test order and confirm it leaves the board cleanly.
- [ ] Do all of the above on the **actual tablet/phone** the shop will use.

## 👥 People

- [ ] Each staff member has their own login and has practised the Counter screen.
- [ ] The owner has read **OWNER-GUIDE.md** and done one morning-dashboard walk-through.
- [ ] Everyone knows who to call when something looks wrong.

## 🚀 Hosting & launch **(tech)**

- [ ] Production deploy is on the canonical Vercel project, custom domain attached
      with HTTPS.
- [ ] `REALTIME_MODE` set to `auto` or `polling` (keep on `polling`/`auto` while
      Supabase Realtime WebSocket is unstable).
- [ ] Database migrations applied to the live database; release report passes in
      `release` mode (not `local`).
- [ ] Full test suite green: lint, typecheck, unit tests, end-to-end tests.
- [ ] A known-good rollback (previous deploy) is available.

---

### The one-line gut check before flipping the sign to "open"

> The temporary login is gone, real prices are loaded, and I have personally placed
> and collected a real order on the shop's own tablet.

If all three are true, you're ready.
