import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT ?? '3100';
const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? `http://127.0.0.1:${port}`;
const usesLocalServer = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(baseURL);

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // Specs share one local Supabase database and a fixed set of seeded orders, so
  // they must run serially to avoid cross-spec state contamination.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 0,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: true,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: usesLocalServer
    ? {
        command: `npx next start -p ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
