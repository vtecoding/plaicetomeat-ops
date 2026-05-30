import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROUTES = [
  '/',
  '/shop',
  '/basket',
  '/checkout',
  '/counter',
  '/counter/compliance',
  '/admin',
  '/admin/products',
  '/admin/orders',
  '/admin/pickup-windows',
  '/admin/compliance',
  '/admin/settings',
];

const ERROR_KEYWORDS = [
  'Unhandled Runtime Error',
  'TypeError',
  'ReferenceError',
  'Hydration failed',
  'Application error',
];

const IGNORED_CONSOLE_SUBSTRS = [
  'ResizeObserver loop limit exceeded',
  'favicon.ico',
  'DevTools listening on',
];

function isIgnoredConsole(text: string) {
  if (!text) return false;
  return IGNORED_CONSOLE_SUBSTRS.some((s) => text.includes(s));
}

test.describe.serial('Playwright full UI audit', () => {
  const results: Array<any> = [];
  const outDir = path.join(process.cwd(), 'audit');

  test.beforeAll(async () => {
    await fs.promises.mkdir(outDir, { recursive: true });
  });

  for (const route of ROUTES) {
    test(route, async ({ page, baseURL }) => {
      const routeResult: any = {
        route,
        passed: true,
        pageErrors: [] as string[],
        consoleErrors: [] as string[],
        clickedButtons: [] as string[],
        httpStatus: null as number | null,
      };

      page.on('pageerror', (err) => {
        routeResult.pageErrors.push(String(err?.message ?? err));
        routeResult.passed = false;
      });

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!isIgnoredConsole(text)) {
            routeResult.consoleErrors.push(text);
            routeResult.passed = false;
          }
        }
      });

      // navigate
      const url = baseURL ? new URL(route, baseURL).toString() : route;
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 45_000 }).catch((e) => {
        routeResult.pageErrors.push(`Navigation failed: ${String(e)}`);
        routeResult.passed = false;
        return null;
      });

      if (resp) {
        routeResult.httpStatus = resp.status();
        if (resp.status() >= 500) {
          routeResult.pageErrors.push(`Server error HTTP ${resp.status()}`);
          routeResult.passed = false;
        }
      }

      // wait briefly for client rendering
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(300);

      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      for (const kw of ERROR_KEYWORDS) {
        if (bodyText.includes(kw)) {
          routeResult.pageErrors.push(`Page contains "${kw}"`);
          routeResult.passed = false;
        }
      }

      // shop-specific: add to basket
      if (route === '/shop') {
        const addBtn = page.locator('button:has-text("Add")').first();
        if ((await addBtn.count()) > 0) {
          try {
            await addBtn.click({ timeout: 5000 });
            routeResult.clickedButtons.push('Add');
            await page.waitForTimeout(300);
          } catch (e) {
            routeResult.consoleErrors.push(`Add button click failed: ${String(e)}`);
            routeResult.passed = false;
          }
        } else {
          routeResult.pageErrors.push('No add-to-basket button found on shop');
          routeResult.passed = false;
        }
      }

      // checkout: check required fields
      if (route === '/checkout') {
        const requiredSelectors = ['#customerName', '#customerPhone', '#pickupDate', '#pickupWindowId'];
        for (const sel of requiredSelectors) {
          const loc = page.locator(sel);
          if ((await loc.count()) === 0) {
            routeResult.pageErrors.push(`Missing checkout field ${sel}`);
            routeResult.passed = false;
            continue;
          }
          const req = await loc.getAttribute('required');
          if (!req) {
            routeResult.pageErrors.push(`Checkout field ${sel} is missing required attribute`);
            routeResult.passed = false;
          }
        }
        const placeBtn = page.locator('button:has-text("Place pay-on-collection order")');
        if ((await placeBtn.count()) === 0) {
          routeResult.pageErrors.push('Place order button not found on checkout');
          routeResult.passed = false;
        }
      }

      // counter: check columns exist
      if (route === '/counter') {
        for (const label of ['Incoming', 'Prepping', 'Ready', 'Collected']) {
          if ((await page.locator(`text=${label}`).count()) === 0) {
            routeResult.pageErrors.push(`Counter missing column "${label}"`);
            routeResult.passed = false;
          }
        }
      }

      // record per-route JSON
      const jsonPath = path.join(outDir, `playwright-ui-audit-${route.replace(/[^a-z0-9]/gi, '_')}.json`);
      await fs.promises.writeFile(jsonPath, JSON.stringify(routeResult, null, 2));

      results.push(routeResult);

      // fail the test if there were page errors or console errors
      expect(routeResult.passed, `Route ${route} had failures`).toBeTruthy();
    });
  }

  test.afterAll(async () => {
    // generate aggregated markdown report
    const mdPath = path.join(outDir, 'playwright-ui-audit.md');
    const passed = results.filter((r) => r.passed).map((r) => r.route);
    const failed = results.filter((r) => !r.passed).map((r) => r.route);

    let md = `# Playwright UI Audit\n\n`;
    md += `Generated: ${new Date().toISOString()}\n\n`;
    md += `**Passed flows:**\n` + (passed.length ? passed.map((p) => `- ${p}`).join('\n') : '- None') + '\n\n';
    md += `**Failed flows:**\n` + (failed.length ? failed.map((f) => `- ${f}`).join('\n') : '- None') + '\n\n';

    md += `**Details**\n\n`;
    for (const r of results) {
      md += `### ${r.route}\n\n`;
      md += `- Passed: ${r.passed}\n`;
      if (r.httpStatus) md += `- HTTP status: ${r.httpStatus}\n`;
      if (r.clickedButtons && r.clickedButtons.length) md += `- Clicked buttons: ${r.clickedButtons.map((b: string) => `\`${b}\``).join(', ')}\n`;
      if (r.pageErrors && r.pageErrors.length) md += `- Page errors:\n${r.pageErrors.map((e: string) => `  - ${e}`).join('\n')}\n`;
      if (r.consoleErrors && r.consoleErrors.length) md += `- Console errors:\n${r.consoleErrors.map((e: string) => `  - ${e}`).join('\n')}\n`;
      md += '\n';
    }

    await fs.promises.writeFile(mdPath, md);
  });
});

import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROUTES = [
  '/',
  '/shop',
  '/basket',
  '/checkout',
  '/counter',
  '/counter/compliance',
  '/admin',
  '/admin/products',
  '/admin/orders',
  '/admin/pickup-windows',
  '/admin/compliance',
  '/admin/settings',
];

const ERROR_KEYWORDS = [
  'Unhandled Runtime Error',
  'TypeError',
  'ReferenceError',
  'Hydration failed',
  'Application error',
];

const IGNORED_CONSOLE_SUBSTRS = [
  'ResizeObserver loop limit exceeded',
  'favicon.ico',
  'DevTools listening on',
];

function isIgnoredConsole(text: string) {
  if (!text) return false;
  return IGNORED_CONSOLE_SUBSTRS.some((s) => text.includes(s));
}

test('Playwright UI audit - single-run', async ({ page, baseURL }) => {
  const outDir = path.join(process.cwd(), 'audit');
  await fs.promises.mkdir(outDir, { recursive: true });

  const results: Array<any> = [];

  for (const route of ROUTES) {
    const routeResult: any = {
      route,
      passed: true,
      pageErrors: [] as string[],
      consoleErrors: [] as string[],
      clickedButtons: [] as string[],
      httpStatus: null as number | null,
    };

    const pageErrorHandler = (err: any) => {
      routeResult.pageErrors.push(String(err?.message ?? err));
      routeResult.passed = false;
    };
    const consoleHandler = (msg: any) => {
      if (msg.type && msg.type() === 'error') {
        const text = msg.text();
        if (!isIgnoredConsole(text)) {
          routeResult.consoleErrors.push(text);
          routeResult.passed = false;
        }
      }
    };

    page.on('pageerror', pageErrorHandler);
    page.on('console', consoleHandler);

    const url = baseURL ? new URL(route, baseURL).toString() : route;
    let resp: any = null;
    try {
      resp = await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    } catch (e) {
      routeResult.pageErrors.push(`Navigation failed: ${String(e)}`);
      routeResult.passed = false;
    }

    if (resp) {
      try {
        routeResult.httpStatus = resp.status();
        if (routeResult.httpStatus >= 500) {
          routeResult.pageErrors.push(`Server error HTTP ${routeResult.httpStatus}`);
          routeResult.passed = false;
        }
      } catch (e) {
        // ignore
      }
    }

    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);

    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    for (const kw of ERROR_KEYWORDS) {
      if (bodyText.includes(kw)) {
        routeResult.pageErrors.push(`Page contains "${kw}"`);
        routeResult.passed = false;
      }
    }

    // Shop check: presence of Add button and attempt click (non-destructive)
    if (route === '/shop') {
      const addBtn = page.locator('button:has-text("Add")').first();
      if ((await addBtn.count()) > 0) {
        try {
          await addBtn.click({ timeout: 5000 });
          routeResult.clickedButtons.push('Add');
          await page.waitForTimeout(300);
        } catch (e) {
          routeResult.consoleErrors.push(`Add button click failed: ${String(e)}`);
          routeResult.passed = false;
        }
      } else {
        routeResult.pageErrors.push('No add-to-basket button found on shop');
        routeResult.passed = false;
      }
    }

    // Checkout basic field checks
    if (route === '/checkout') {
      const requiredSelectors = ['#customerName', '#customerPhone', '#pickupDate', '#pickupWindowId'];
      for (const sel of requiredSelectors) {
        const loc = page.locator(sel);
        if ((await loc.count()) === 0) {
          routeResult.pageErrors.push(`Missing checkout field ${sel}`);
          routeResult.passed = false;
          continue;
        }
        const req = await loc.getAttribute('required');
        if (!req) {
          routeResult.pageErrors.push(`Checkout field ${sel} is missing required attribute`);
          routeResult.passed = false;
        }
      }
      const placeBtn = page.locator('button:has-text("Place pay-on-collection order")');
      if ((await placeBtn.count()) === 0) {
        routeResult.pageErrors.push('Place order button not found on checkout');
        routeResult.passed = false;
      }
    }

    // Counter column checks
    if (route === '/counter') {
      for (const label of ['Incoming', 'Prepping', 'Ready', 'Collected']) {
        if ((await page.locator(`text=${label}`).count()) === 0) {
          routeResult.pageErrors.push(`Counter missing column "${label}"`);
          routeResult.passed = false;
        }
      }
    }

    // write per-route JSON
    const jsonPath = path.join(outDir, `playwright-ui-audit-${route.replace(/[^a-z0-9]/gi, '_')}.json`);
    await fs.promises.writeFile(jsonPath, JSON.stringify(routeResult, null, 2));

    results.push(routeResult);

    // remove listeners for next iteration
    page.off('pageerror', pageErrorHandler);
    page.off('console', consoleHandler);
  }

  // generate aggregated markdown report
  const mdPath = path.join(outDir, 'playwright-ui-audit.md');
  const passed = results.filter((r) => r.passed).map((r) => r.route);
  const failed = results.filter((r) => !r.passed).map((r) => r.route);

  const mdLines: string[] = [];
  mdLines.push('# Playwright UI Audit', '');
  mdLines.push(`Generated: ${new Date().toISOString()}`, '');

  mdLines.push('**Passed flows:**');
  if (passed.length) mdLines.push(...passed.map((p) => `- ${p}`));
  else mdLines.push('- None');
  mdLines.push('');

  mdLines.push('**Failed flows:**');
  if (failed.length) mdLines.push(...failed.map((f) => `- ${f}`));
  else mdLines.push('- None');
  mdLines.push('', '**Details**', '');

  for (const r of results) {
    mdLines.push(`### ${r.route}`, '');
    mdLines.push(`- Passed: ${r.passed}`);
    if (r.httpStatus) mdLines.push(`- HTTP status: ${r.httpStatus}`);
    if (r.clickedButtons && r.clickedButtons.length) mdLines.push(`- Clicked buttons: ${r.clickedButtons.map((b: string) => `\`${b}\``).join(', ')}`);
    if (r.pageErrors && r.pageErrors.length) mdLines.push('- Page errors:', ...r.pageErrors.map((e: string) => `  - ${e}`));
    if (r.consoleErrors && r.consoleErrors.length) mdLines.push('- Console errors:', ...r.consoleErrors.map((e: string) => `  - ${e}`));
    mdLines.push('');
  }

  await fs.promises.writeFile(mdPath, mdLines.join('\n'));
});
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROUTES = [
  '/',
  '/shop',
  '/basket',
  '/checkout',
  '/counter',
  '/counter/compliance',
  '/admin',
  '/admin/products',
  '/admin/orders',
  '/admin/pickup-windows',
  '/admin/compliance',
  '/admin/settings',
];

const ERROR_KEYWORDS = [
  'Unhandled Runtime Error',
  'TypeError',
  'ReferenceError',
  'Hydration failed',
  'Application error',
];

const IGNORED_CONSOLE_SUBSTRS = [
  'ResizeObserver loop limit exceeded',
  'favicon.ico',
  'DevTools listening on',
];

function isIgnoredConsole(text: string) {
  if (!text) return false;
  return IGNORED_CONSOLE_SUBSTRS.some((s) => text.includes(s));
}

test('Playwright UI audit - single-run', async ({ page, baseURL }) => {
  const outDir = path.join(process.cwd(), 'audit');
  await fs.promises.mkdir(outDir, { recursive: true });

  const results: Array<any> = [];

  for (const route of ROUTES) {
    const routeResult: any = {
      route,
      passed: true,
      pageErrors: [] as string[],
      consoleErrors: [] as string[],
      clickedButtons: [] as string[],
      httpStatus: null as number | null,
    };

    const pageErrorHandler = (err: any) => {
      routeResult.pageErrors.push(String(err?.message ?? err));
      routeResult.passed = false;
    };
    const consoleHandler = (msg: any) => {
      if (msg.type && msg.type() === 'error') {
        const text = msg.text();
        if (!isIgnoredConsole(text)) {
          routeResult.consoleErrors.push(text);
          routeResult.passed = false;
        }
      }
    };

    page.on('pageerror', pageErrorHandler);
    page.on('console', consoleHandler);

    const url = baseURL ? new URL(route, baseURL).toString() : route;
    let resp: any = null;
    try {
      resp = await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    } catch (e) {
      routeResult.pageErrors.push(`Navigation failed: ${String(e)}`);
      routeResult.passed = false;
    }

    if (resp) {
      try {
        routeResult.httpStatus = resp.status();
        if (routeResult.httpStatus >= 500) {
          routeResult.pageErrors.push(`Server error HTTP ${routeResult.httpStatus}`);
          routeResult.passed = false;
        }
      } catch (e) {
        // ignore
      }
    }

    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);

    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    for (const kw of ERROR_KEYWORDS) {
      if (bodyText.includes(kw)) {
        routeResult.pageErrors.push(`Page contains "${kw}"`);
        routeResult.passed = false;
      }
    }

    // Shop check: presence of Add button and attempt click (non-destructive)
    if (route === '/shop') {
      const addBtn = page.locator('button:has-text("Add")').first();
      if ((await addBtn.count()) > 0) {
        try {
          await addBtn.click({ timeout: 5000 });
          routeResult.clickedButtons.push('Add');
          await page.waitForTimeout(300);
        } catch (e) {
          routeResult.consoleErrors.push(`Add button click failed: ${String(e)}`);
          routeResult.passed = false;
        }
      } else {
        routeResult.pageErrors.push('No add-to-basket button found on shop');
        routeResult.passed = false;
      }
    }

    // Checkout basic field checks
    if (route === '/checkout') {
      const requiredSelectors = ['#customerName', '#customerPhone', '#pickupDate', '#pickupWindowId'];
      for (const sel of requiredSelectors) {
        const loc = page.locator(sel);
        if ((await loc.count()) === 0) {
          routeResult.pageErrors.push(`Missing checkout field ${sel}`);
          routeResult.passed = false;
          continue;
        }
        const req = await loc.getAttribute('required');
        if (!req) {
          routeResult.pageErrors.push(`Checkout field ${sel} is missing required attribute`);
          routeResult.passed = false;
        }
      }
      const placeBtn = page.locator('button:has-text("Place pay-on-collection order")');
      if ((await placeBtn.count()) === 0) {
        routeResult.pageErrors.push('Place order button not found on checkout');
        routeResult.passed = false;
      }
    }

    // Counter column checks
    if (route === '/counter') {
      for (const label of ['Incoming', 'Prepping', 'Ready', 'Collected']) {
        if ((await page.locator(`text=${label}`).count()) === 0) {
          routeResult.pageErrors.push(`Counter missing column "${label}"`);
          routeResult.passed = false;
        }
      }
    }

    // write per-route JSON
    const jsonPath = path.join(outDir, `playwright-ui-audit-${route.replace(/[^a-z0-9]/gi, '_')}.json`);
    await fs.promises.writeFile(jsonPath, JSON.stringify(routeResult, null, 2));

    results.push(routeResult);

    // remove listeners for next iteration
    page.off('pageerror', pageErrorHandler);
    page.off('console', consoleHandler);
  }

  // generate aggregated markdown report
  const mdPath = path.join(outDir, 'playwright-ui-audit.md');
  const passed = results.filter((r) => r.passed).map((r) => r.route);
  const failed = results.filter((r) => !r.passed).map((r) => r.route);

  const mdLines: string[] = [];
  mdLines.push('# Playwright UI Audit', '');
  mdLines.push(`Generated: ${new Date().toISOString()}`, '');

  mdLines.push('**Passed flows:**');
  if (passed.length) mdLines.push(...passed.map((p) => `- ${p}`));
  else mdLines.push('- None');
  mdLines.push('');

  mdLines.push('**Failed flows:**');
  if (failed.length) mdLines.push(...failed.map((f) => `- ${f}`));
  else mdLines.push('- None');
  mdLines.push('', '**Details**', '');

  for (const r of results) {
    mdLines.push(`### ${r.route}`, '');
    mdLines.push(`- Passed: ${r.passed}`);
    if (r.httpStatus) mdLines.push(`- HTTP status: ${r.httpStatus}`);
    if (r.clickedButtons && r.clickedButtons.length) mdLines.push(`- Clicked buttons: ${r.clickedButtons.map((b: string) => `\`${b}\``).join(', ')}`);
    if (r.pageErrors && r.pageErrors.length) mdLines.push('- Page errors:', ...r.pageErrors.map((e: string) => `  - ${e}`));
    if (r.consoleErrors && r.consoleErrors.length) mdLines.push('- Console errors:', ...r.consoleErrors.map((e: string) => `  - ${e}`));
    mdLines.push('');
  }

  await fs.promises.writeFile(mdPath, mdLines.join('\n'));
});
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROUTES = [
  '/',
  '/shop',
  '/basket',
  '/checkout',
  '/counter',
  '/counter/compliance',
  '/admin',
  '/admin/products',
  '/admin/orders',
  '/admin/pickup-windows',
  '/admin/compliance',
  '/admin/settings',
];

const ERROR_KEYWORDS = [
  'Unhandled Runtime Error',
  'TypeError',
  'ReferenceError',
  'Hydration failed',
  'Application error',
];

const IGNORED_CONSOLE_SUBSTRS = [
  'ResizeObserver loop limit exceeded',
  'favicon.ico',
  'DevTools listening on',
];

function isIgnoredConsole(text: string) {
  if (!text) return false;
  return IGNORED_CONSOLE_SUBSTRS.some((s) => text.includes(s));
}

test.describe.serial('Playwright full UI audit', () => {
  const results: Array<any> = [];
  const outDir = path.join(process.cwd(), 'audit');

  test.beforeAll(async () => {
    await fs.promises.mkdir(outDir, { recursive: true });
  });

  for (const route of ROUTES) {
    test(route, async ({ page, baseURL }) => {
      const routeResult: any = {
        route,
        passed: true,
        pageErrors: [] as string[],
        consoleErrors: [] as string[],
        clickedButtons: [] as string[],
        httpStatus: null as number | null,
      };

      page.on('pageerror', (err) => {
        routeResult.pageErrors.push(String(err?.message ?? err));
        routeResult.passed = false;
      });

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!isIgnoredConsole(text)) {
            routeResult.consoleErrors.push(text);
            routeResult.passed = false;
          }
        }
      });

      // navigate
      const url = baseURL ? new URL(route, baseURL).toString() : route;
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 45_000 }).catch((e) => {
        routeResult.pageErrors.push(`Navigation failed: ${String(e)}`);
        routeResult.passed = false;
        return null;
      });

      if (resp) {
        routeResult.httpStatus = resp.status();
        if (resp.status() >= 500) {
          routeResult.pageErrors.push(`Server error HTTP ${resp.status()}`);
          routeResult.passed = false;
        }
      }

      // wait briefly for client rendering
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(300);

      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      for (const kw of ERROR_KEYWORDS) {
        if (bodyText.includes(kw)) {
          routeResult.pageErrors.push(`Page contains "${kw}"`);
          routeResult.passed = false;
        }
      }

      // shop-specific: add to basket
      if (route === '/shop') {
        const addBtn = page.locator('button:has-text("Add")').first();
        if ((await addBtn.count()) > 0) {
          try {
            await addBtn.click({ timeout: 5000 });
            routeResult.clickedButtons.push('Add');
            await page.waitForTimeout(300);
          } catch (e) {
            routeResult.consoleErrors.push(`Add button click failed: ${String(e)}`);
            routeResult.passed = false;
          }
        } else {
          routeResult.pageErrors.push('No add-to-basket button found on shop');
          routeResult.passed = false;
        }
      }

      // attempt to click visible enabled buttons (defensive)
      const buttons = page.locator('button:visible');
      const btnCount = await buttons.count();
      for (let i = 0; i < btnCount; i++) {
        try {
          const btn = buttons.nth(i);
          const text = (await btn.innerText().catch(() => '')).trim();
          if (/Simulate new order/i.test(text)) continue;
          try {
            await btn.click({ timeout: 5000 });
            routeResult.clickedButtons.push(text || '<icon>');
            await page.waitForTimeout(150);
          } catch (e) {
            routeResult.consoleErrors.push(`Click failed for \"${text}\": ${String(e)}`);
            routeResult.passed = false;
          }
        } catch (e) {
          routeResult.consoleErrors.push(`Button iteration error: ${String(e)}`);
          routeResult.passed = false;
        }
      }

      // validate basket after shop
      if (route === '/shop') {
        const basketUrl = baseURL ? new URL('/basket', baseURL).toString() : '/basket';
        await page.goto(basketUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => null);
        await page.waitForTimeout(300);
        const emptyBanner = page.locator('text=Your basket is empty');
        if ((await emptyBanner.count()) > 0 && (await emptyBanner.isVisible())) {
          routeResult.pageErrors.push('Basket is still empty after adding a product');
          routeResult.passed = false;
        }
      }

      // checkout: check required fields
      if (route === '/checkout') {
        const requiredSelectors = ['#customerName', '#customerPhone', '#pickupDate', '#pickupWindowId'];
        for (const sel of requiredSelectors) {
          const loc = page.locator(sel);
          if ((await loc.count()) === 0) {
            routeResult.pageErrors.push(`Missing checkout field ${sel}`);
            routeResult.passed = false;
            continue;
          }
          const req = await loc.getAttribute('required');
          if (!req) {
            routeResult.pageErrors.push(`Checkout field ${sel} is missing required attribute`);
            routeResult.passed = false;
          }
        }
        const placeBtn = page.locator('button:has-text("Place pay-on-collection order")');
        if ((await placeBtn.count()) === 0) {
          routeResult.pageErrors.push('Place order button not found on checkout');
          routeResult.passed = false;
        }
      }

      // counter: check columns exist
      if (route === '/counter') {
        for (const label of ['Incoming', 'Prepping', 'Ready', 'Collected']) {
          if ((await page.locator(`text=${label}`).count()) === 0) {
            routeResult.pageErrors.push(`Counter missing column \"${label}\"`);
            routeResult.passed = false;
          }
        }
      }

      // record per-route JSON
      const jsonPath = path.join(outDir, `playwright-ui-audit-${route.replace(/[^a-z0-9]/gi, '_')}.json`);
      await fs.promises.writeFile(jsonPath, JSON.stringify(routeResult, null, 2));

      results.push(routeResult);

      // fail the test if there were page errors or console errors
      expect(routeResult.passed, `Route ${route} had failures`).toBeTruthy();
    });
  }

  test.afterAll(async () => {
    // generate aggregated markdown report
    const mdPath = path.join(outDir, 'playwright-ui-audit.md');
    const passed = results.filter((r) => r.passed).map((r) => r.route);
    const failed = results.filter((r) => !r.passed).map((r) => r.route);

    let md = `# Playwright UI Audit\\n\\n`;
    md += `Generated: ${new Date().toISOString()}\\n\\n`;
    md += `**Passed flows:**\\n` + (passed.length ? passed.map((p) => `- ${p}`).join('\\n') : '- None') + '\\n\\n';
    md += `**Failed flows:**\\n` + (failed.length ? failed.map((f) => `- ${f}`).join('\\n') : '- None') + '\\n\\n';

    md += `**Details**\\n\\n`;
    for (const r of results) {
      md += `### ${r.route}\\n\\n`;
      md += `- Passed: ${r.passed}\\n`;
      if (r.httpStatus) md += `- HTTP status: ${r.httpStatus}\\n`;
      if (r.clickedButtons && r.clickedButtons.length) md += `- Clicked buttons: ${r.clickedButtons.map((b: string) => `\\`${b}\\``).join(', ')}\\n`;
      if (r.pageErrors && r.pageErrors.length) md += `- Page errors:\\n${r.pageErrors.map((e: string) => `  - ${e}`).join('\\n')}\\n`;
      if (r.consoleErrors && r.consoleErrors.length) md += `- Console errors:\\n${r.consoleErrors.map((e: string) => `  - ${e}`).join('\\n')}\\n`;
      md += '\\n';
    }

    await fs.promises.writeFile(mdPath, md);
  });
});

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROUTES = [
  '/',
  '/shop',
  '/basket',
  '/checkout',
  '/counter',
  import { test, expect } from '@playwright/test';
  import fs from 'fs';
  import path from 'path';

  const ROUTES = [
    '/',
    '/shop',
    '/basket',
    '/checkout',
    '/counter',
    '/counter/compliance',
    '/admin',
    '/admin/products',
    '/admin/orders',
    '/admin/pickup-windows',
    '/admin/compliance',
    '/admin/settings',
  ];

  const ERROR_KEYWORDS = [
    'Unhandled Runtime Error',
    'TypeError',
    'ReferenceError',
    'Hydration failed',
    'Application error',
  ];

  const IGNORED_CONSOLE_SUBSTRS = [
    'ResizeObserver loop limit exceeded',
    'favicon.ico',
    'DevTools listening on',
  ];

  function isIgnoredConsole(text: string) {
    if (!text) return false;
    return IGNORED_CONSOLE_SUBSTRS.some((s) => text.includes(s));
  }

  test.describe.serial('Playwright full UI audit', () => {
    const results: Array<any> = [];
    const outDir = path.join(process.cwd(), 'audit');

    test.beforeAll(async () => {
      await fs.promises.mkdir(outDir, { recursive: true });
    });

    for (const route of ROUTES) {
      test(route, async ({ page, baseURL }) => {
        const routeResult: any = {
          route,
          passed: true,
          pageErrors: [] as string[],
          consoleErrors: [] as string[],
          clickedButtons: [] as string[],
          httpStatus: null as number | null,
        };

        page.on('pageerror', (err) => {
          routeResult.pageErrors.push(String(err?.message ?? err));
          routeResult.passed = false;
        });

        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            const text = msg.text();
            if (!isIgnoredConsole(text)) {
              routeResult.consoleErrors.push(text);
              routeResult.passed = false;
            }
          }
        });

        // navigate
        const url = baseURL ? new URL(route, baseURL).toString() : route;
        const resp = await page.goto(url, { waitUntil: 'load', timeout: 45_000 }).catch((e) => {
          routeResult.pageErrors.push(`Navigation failed: ${String(e)}`);
          routeResult.passed = false;
          return null;
        });

        if (resp) {
          routeResult.httpStatus = resp.status();
          if (resp.status() >= 500) {
            routeResult.pageErrors.push(`Server error HTTP ${resp.status()}`);
            routeResult.passed = false;
          }
        }

        // wait briefly for client rendering
        await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(300);

        const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
        for (const kw of ERROR_KEYWORDS) {
          if (bodyText.includes(kw)) {
            routeResult.pageErrors.push(`Page contains "${kw}"`);
            routeResult.passed = false;
          }
        }

        // shop-specific: add to basket
        if (route === '/shop') {
          const addBtn = page.locator('button:has-text("Add")').first();
          if ((await addBtn.count()) > 0) {
            try {
              await addBtn.click({ timeout: 5000 });
              routeResult.clickedButtons.push('Add');
              await page.waitForTimeout(300);
            } catch (e) {
              routeResult.consoleErrors.push(`Add button click failed: ${String(e)}`);
              routeResult.passed = false;
            }
          } else {
            routeResult.pageErrors.push('No add-to-basket button found on shop');
            routeResult.passed = false;
          }
        }

        // attempt to click visible enabled buttons (defensive)
        const buttons = page.locator('button:visible');
        const btnCount = await buttons.count();
        for (let i = 0; i < btnCount; i++) {
          try {
            const btn = buttons.nth(i);
            const text = (await btn.innerText().catch(() => '')).trim();
            if (/Simulate new order/i.test(text)) continue;
            try {
              await btn.click({ timeout: 5000 });
              routeResult.clickedButtons.push(text || '<icon>');
              await page.waitForTimeout(150);
            } catch (e) {
              routeResult.consoleErrors.push(`Click failed for \"${text}\": ${String(e)}`);
              routeResult.passed = false;
            }
          } catch (e) {
            routeResult.consoleErrors.push(`Button iteration error: ${String(e)}`);
            routeResult.passed = false;
          }
        }

        // validate basket after shop
        if (route === '/shop') {
          const basketUrl = baseURL ? new URL('/basket', baseURL).toString() : '/basket';
          await page.goto(basketUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => null);
          await page.waitForTimeout(300);
          const emptyBanner = page.locator('text=Your basket is empty');
          if ((await emptyBanner.count()) > 0 && (await emptyBanner.isVisible())) {
            routeResult.pageErrors.push('Basket is still empty after adding a product');
            routeResult.passed = false;
          }
        }

        // checkout: check required fields
        if (route === '/checkout') {
          const requiredSelectors = ['#customerName', '#customerPhone', '#pickupDate', '#pickupWindowId'];
          for (const sel of requiredSelectors) {
            const loc = page.locator(sel);
            if ((await loc.count()) === 0) {
              routeResult.pageErrors.push(`Missing checkout field ${sel}`);
              routeResult.passed = false;
              continue;
            }
            const req = await loc.getAttribute('required');
            if (!req) {
              routeResult.pageErrors.push(`Checkout field ${sel} is missing required attribute`);
              routeResult.passed = false;
            }
          }
          const placeBtn = page.locator('button:has-text("Place pay-on-collection order")');
          if ((await placeBtn.count()) === 0) {
            routeResult.pageErrors.push('Place order button not found on checkout');
            routeResult.passed = false;
          }
        }

        // counter: check columns exist
        if (route === '/counter') {
          for (const label of ['Incoming', 'Prepping', 'Ready', 'Collected']) {
            if ((await page.locator(`text=${label}`).count()) === 0) {
              routeResult.pageErrors.push(`Counter missing column \"${label}\"`);
              routeResult.passed = false;
            }
          }
        }

        // record per-route JSON
        const jsonPath = path.join(outDir, `playwright-ui-audit-${route.replace(/[^a-z0-9]/gi, '_')}.json`);
        await fs.promises.writeFile(jsonPath, JSON.stringify(routeResult, null, 2));

        results.push(routeResult);

        // fail the test if there were page errors or console errors
        expect(routeResult.passed, `Route ${route} had failures`).toBeTruthy();
      });
    }

    test.afterAll(async () => {
      // generate aggregated markdown report
      const mdPath = path.join(outDir, 'playwright-ui-audit.md');
      const passed = results.filter((r) => r.passed).map((r) => r.route);
      const failed = results.filter((r) => !r.passed).map((r) => r.route);

      let md = `# Playwright UI Audit\n\n`;
      md += `Generated: ${new Date().toISOString()}\n\n`;
      md += `**Passed flows:**\n` + (passed.length ? passed.map((p) => `- ${p}`).join('\n') : '- None') + '\n\n';
      md += `**Failed flows:**\n` + (failed.length ? failed.map((f) => `- ${f}`).join('\n') : '- None') + '\n\n';

      md += `**Details**\n\n`;
      for (const r of results) {
        md += `### ${r.route}\n\n`;
        md += `- Passed: ${r.passed}\n`;
        if (r.httpStatus) md += `- HTTP status: ${r.httpStatus}\n`;
        if (r.clickedButtons && r.clickedButtons.length) md += `- Clicked buttons: ${r.clickedButtons.map((b: string) => `\`${b}\``).join(', ')}\n`;
        if (r.pageErrors && r.pageErrors.length) md += `- Page errors:\n${r.pageErrors.map((e: string) => `  - ${e}`).join('\n')}\n`;
        if (r.consoleErrors && r.consoleErrors.length) md += `- Console errors:\n${r.consoleErrors.map((e: string) => `  - ${e}`).join('\n')}\n`;
        md += '\n';
      }

      await fs.promises.writeFile(mdPath, md);
    });
  });
