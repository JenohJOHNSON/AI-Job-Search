import { expect, test } from "@playwright/test";
import { signIn } from "./support";

// Runs with a phone viewport: navigation must be reachable and no page may overflow horizontally (wide tables and the board scroll inside their own container).
const pages = ["/", "/jobs", "/applications", "/profile", "/search-profiles", "/providers", "/runs", "/settings"];

test("the mobile menu opens, navigates and closes", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Discover jobs" }).click();
  await expect(page).toHaveURL(/\/jobs/); await expect(page.getByRole("heading", { name: /Opportunities worth a closer look/ })).toBeVisible();
});

for (const path of pages) {
  test(`${path} fits a phone screen without horizontal page scroll`, async ({ page }) => {
    await signIn(page); await page.goto(path); await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(1);
  });
}

test("a job can be opened and acted on from a phone", async ({ page }) => {
  await signIn(page); await page.goto("/jobs"); await page.locator(".job-row a").first().click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(overflow).toBeLessThanOrEqual(1);
});
