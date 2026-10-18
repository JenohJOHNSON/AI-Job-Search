import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Cookie, type Page } from "@playwright/test";

export const owner = { email: "owner@example.test", password: "correct-horse-battery-staple" };
export const setupSecret = () => process.env.SETUP_SECRET ?? "";

// The login endpoint is rate limited (8 attempts per 15 minutes per client), exactly as in production. Tests therefore
// sign in through the UI once and reuse that session; they fall back to a UI login only when the session is gone.
// The session is also kept in a git-ignored file so a failing test (which restarts the worker) cannot lose it.
const sessionFile = path.join(__dirname, ".session.json");
let session: Cookie[] | null = existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, "utf8")) as Cookie[] : null;

async function uiLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").waitFor(); // the form renders only after the session check, so the heading below is reliable
  const setup = await page.getByRole("heading", { name: "Create your private workspace" }).isVisible();
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  if (setup) await page.getByLabel("Deployment setup secret").fill(setupSecret());
  await page.getByRole("button", { name: setup ? "Create workspace" : "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your search, in focus." })).toBeVisible();
}

/** Creates the owner on a fresh database, or signs in when the owner already exists. */
export async function signIn(page: Page) {
  if (session) {
    await page.context().addCookies(session); await page.goto("/");
    const restored = await expect(page.getByRole("heading", { name: "Your search, in focus." })).toBeVisible({ timeout: 8_000 }).then(() => true, () => false);
    if (restored) return;
    await page.context().clearCookies();
  }
  await uiLogin(page); await rememberSession(page);
}
export async function rememberSession(page: Page) { session = await page.context().cookies(); writeFileSync(sessionFile, JSON.stringify(session)); }

export const job = {
  title: "Ingénieur Data (H/F)", company: "Société Exemple (test data)", location: "Metz",
  description: "Synthetic test posting. Vous concevez des pipelines ETL. Compétences requises : SQL Server, SSIS, Python, Azure Data Factory. 3 ans d'expérience. CDI. Télétravail partiel possible 2 jours par semaine."
};
