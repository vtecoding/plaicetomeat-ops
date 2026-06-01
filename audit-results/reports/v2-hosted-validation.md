# PlaiceToMeat Ops - Canonical Hosted Validation Summary

_Canonical production URL: `https://plaicetomeat-ops.vercel.app`_
_Project owner/account: `vtecoding`_

This report preserves the production validation findings while removing references
to any prior duplicate deployment. The canonical Vercel deployment is the only
deployment that should be used for customer-facing links and release checks.

## Current Canonical Status

- Canonical production: `https://plaicetomeat-ops.vercel.app`
- Canonical login route: `/login`
- Protected routes redirect unauthenticated users to `/login`
- Public storefront routes remain available without auth
- Realtime is released in honest degraded mode when the websocket fails

## Release Notes

- `REALTIME_MODE` supports `websocket`, `polling`, and `auto`
- Production defaults to `auto`
- `CHECKOUT_TEST_MODE_ENABLED` remains `false` on production
- Twilio variables remain unset for production safety
- The local release gates are now built around `next build` plus `next start`

## Verification Summary

- Typecheck: PASS
- Lint: PASS
- Unit: PASS
- Build: PASS
- Ops Verify: PASS
- Playwright Smoke: PASS
- Playwright V2.1: PASS
- Playwright Full: PASS
- Hosted Smoke: FAIL until the canonical deployment is updated to the latest branch

## Notes

- The repository should not reference any previous duplicate deployment or alternate owner account.
- A fresh deploy to canonical production is required before hosted smoke can pass.
