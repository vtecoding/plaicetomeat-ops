# PlaiceToMeat Ops

PlaiceToMeat Ops is a Next.js 15 click-and-collect ordering system and counter dashboard for a premium HMC halal butcher.

V1 is pay-on-collection only: customers place an order online, collect from the counter, and pay using the shop till or card reader.

## Stack

- Next.js 15 App Router
- Tailwind CSS v4
- shadcn-style local UI primitives
- Supabase Postgres/Auth/Realtime
- Twilio SMS
- Zod validation
- Vitest and Playwright

## Local Setup

```bash
corepack pnpm install
cp .env.example .env.local
```

Fill in `.env.local`, then:

```bash
npx supabase start
npx supabase db push
npx supabase db seed
corepack pnpm dev
```

## Tests

```bash
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm lint
corepack pnpm typecheck
```

## Build Notes

- All core tables include `branch_id`.
- Public basket data lives in `localStorage` under `ptm_basket_{branchId}` and expires after 24 hours.
- Server-side code must recalculate order totals from database product prices.
- `SUPABASE_SERVICE_ROLE_KEY` and Twilio credentials must stay server-only.
- The app supports compliance record-keeping. It must not claim to guarantee an EHO hygiene rating.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
