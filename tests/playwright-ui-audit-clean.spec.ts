import { test, type ConsoleMessage, type Page, type Response } from "@playwright/test";
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

test("Playwright UI audit - single-run", async ({ page, baseURL }) => {
  const outDir = path.join(process.cwd(), "audit");
  await fs.promises.mkdir(outDir, { recursive: true });

  const results: AuditResult[] = [];

  for (const route of ROUTES) {
    const routeResult = createResult(route);
    attachAuditListeners(page, routeResult);

    const url = baseURL ? new URL(route, baseURL).toString() : route;
    let response: Response | null = null;

    try {
      response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    } catch (error) {
      routeResult.pageErrors.push(`Navigation failed: ${String(error)}`);
      routeResult.passed = false;
    }

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

    if (route === "/shop") {
      const addButton = page.locator('button:has-text("Add")').first();

      if ((await addButton.count()) > 0) {
        try {
          await addButton.click({ timeout: 5000 });
          routeResult.clickedButtons.push("Add");
          await page.waitForTimeout(300);
        } catch (error) {
          routeResult.consoleErrors.push(`Add button click failed: ${String(error)}`);
          routeResult.passed = false;
        }
      } else {
        routeResult.pageErrors.push("No add-to-basket button found on shop");
        routeResult.passed = false;
      }
    }

    results.push(routeResult);
  }

  const mdPath = path.join(outDir, "playwright-ui-audit-clean.md");
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

    if (result.clickedButtons.length > 0) {
      markdown += `- Clicked buttons: ${result.clickedButtons.map((button) => `\`${button}\``).join(", ")}\n`;
    }

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
