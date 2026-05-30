import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const ROUTES = [
  "/",
  "/shop",
  "/basket",
  "/checkout",
  "/counter",
  "/counter/compliance",
  "/admin",
  "/admin/products",
  "/admin/orders",
  "/admin/pickup-windows",
  "/admin/compliance",
  "/admin/settings",
];

const ERROR_KEYWORDS = [
  "Unhandled Runtime Error",
  "TypeError",
  "ReferenceError",
  "Hydration failed",
  "Application error",
];

const IGNORED_CONSOLE_SUBSTRS = [
  "ResizeObserver loop limit exceeded",
  "favicon.ico",
  "DevTools listening on",
];

type AuditResult = {
  route: string;
  passed: boolean;
  pageErrors: string[];
  consoleErrors: string[];
  clickedButtons: string[];
  httpStatus: number | null;
};

function isIgnoredConsole(text: string) {
  return IGNORED_CONSOLE_SUBSTRS.some((substring) => text.includes(substring));
}

function createResult(route: string): AuditResult {
  return {
    route,
    passed: true,
    pageErrors: [],
    consoleErrors: [],
    clickedButtons: [],
    httpStatus: null,
  };
}

function attachAuditListeners(page: Page, routeResult: AuditResult) {
  page.on("pageerror", (error) => {
    routeResult.pageErrors.push(String(error?.message ?? error));
    routeResult.passed = false;
  });

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") {
      return;
    }

    const text = message.text();

    if (!isIgnoredConsole(text)) {
      routeResult.consoleErrors.push(text);
      routeResult.passed = false;
    }
  });
}

test.describe.serial("Playwright full UI audit", () => {
  const results: AuditResult[] = [];
  const outDir = path.join(process.cwd(), "audit");

  test.beforeAll(async () => {
    await fs.promises.mkdir(outDir, { recursive: true });
  });

  for (const route of ROUTES) {
    test(route, async ({ page, baseURL }) => {
      const routeResult = createResult(route);
      attachAuditListeners(page, routeResult);

      const url = baseURL ? new URL(route, baseURL).toString() : route;
      const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 }).catch((error: unknown) => {
        routeResult.pageErrors.push(`Navigation failed: ${String(error)}`);
        routeResult.passed = false;
        return null;
      });

      if (response) {
        routeResult.httpStatus = response.status();

        if (routeResult.httpStatus >= 500) {
          routeResult.pageErrors.push(`Server error HTTP ${routeResult.httpStatus}`);
          routeResult.passed = false;
        }
      }

      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(300);

      const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";

      for (const keyword of ERROR_KEYWORDS) {
        if (bodyText.includes(keyword)) {
          routeResult.pageErrors.push(`Page contains "${keyword}"`);
          routeResult.passed = false;
        }
      }

      await expect(page.locator("body")).toBeVisible();
      results.push(routeResult);
    });
  }

  test.afterAll(async () => {
    const mdPath = path.join(outDir, "playwright-ui-audit.md");
    const passed = results.filter((result) => result.passed).map((result) => result.route);
    const failed = results.filter((result) => !result.passed).map((result) => result.route);

    let markdown = "# Playwright UI Audit\n\n";
    markdown += `Generated: ${new Date().toISOString()}\n\n`;
    markdown += `**Passed flows:**\n${passed.length ? passed.map((route) => `- ${route}`).join("\n") : "- None"}\n\n`;
    markdown += `**Failed flows:**\n${failed.length ? failed.map((route) => `- ${route}`).join("\n") : "- None"}\n\n`;
    markdown += "**Details**\n\n";

    for (const result of results) {
      markdown += `### ${result.route}\n\n`;
      markdown += `- Passed: ${result.passed}\n`;
      markdown += `- HTTP status: ${result.httpStatus ?? "n/a"}\n`;

      if (result.pageErrors.length > 0) {
        markdown += `- Page errors:\n${result.pageErrors.map((error) => `  - ${error}`).join("\n")}\n`;
      }

      if (result.consoleErrors.length > 0) {
        markdown += `- Console errors:\n${result.consoleErrors.map((error) => `  - ${error}`).join("\n")}\n`;
      }

      markdown += "\n";
    }

    await fs.promises.writeFile(mdPath, markdown);
  });
});
