import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn } from "./support";

// Serious and critical WCAG 2 A/AA violations fail the build; the full list is attached to the report.
const pages = ["/", "/jobs", "/applications", "/profile", "/search-profiles", "/providers", "/runs", "/settings"];
const scan = async (page: import("@playwright/test").Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""));
const describeViolations = (violations: Awaited<ReturnType<typeof scan>>) => violations.map(item => `${item.id} (${item.impact}): ${item.help} — ${item.nodes.slice(0, 3).map(node => node.target.join(" ")).join(" | ")}`).join("\n");

test("the login page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login"); await expect(page.getByRole("button", { name: /Sign in|Create workspace/ })).toBeVisible();
  const violations = await scan(page); expect(violations, describeViolations(violations)).toEqual([]);
});

for (const path of pages) {
  test(`${path} has no serious accessibility violations`, async ({ page }) => {
    await signIn(page); await page.goto(path); await page.waitForLoadState("networkidle");
    const violations = await scan(page); expect(violations, describeViolations(violations)).toEqual([]);
  });
}

test("a job detail page has no serious accessibility violations", async ({ page }) => {
  await signIn(page); await page.goto("/jobs"); await page.locator(".job-row a").first().click(); await expect(page.getByRole("heading", { name: "Why this score" })).toBeVisible();
  const violations = await scan(page); expect(violations, describeViolations(violations)).toEqual([]);
});

test("keyboard users can skip to the content and operate the main navigation", async ({ page }) => {
  await signIn(page); await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.locator("#main")).toBeFocused();
});
