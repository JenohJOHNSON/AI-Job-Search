import { expect, test } from "@playwright/test";
import PDFDocument from "pdfkit";
import { job, owner, rememberSession, signIn } from "./support";

// One continuous owner journey: each step builds on the previous one, exactly as a real user would.
test.describe.configure({ mode: "serial" });

test("a new owner can set up, sign out and sign in again", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Get started")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your search, in focus." })).toBeVisible();
  await rememberSession(page);
});

test("private pages redirect anonymous visitors to the login page", async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto("/jobs"); await expect(page).toHaveURL(/\/login/);
  expect((await context.request.get("/api/jobs")).status()).toBe(401);
  await context.close();
});

test("the profile is saved, survives a reload, and a CV can be uploaded and downloaded", async ({ page }) => {
  await signIn(page); await page.goto("/profile");
  await page.getByLabel("Home location").fill("Metz");
  await page.getByLabel("Years of experience").fill("5");
  await page.getByLabel("Target roles").fill("Data Engineer\nIngénieur Data\nDéveloppeur ETL");
  await page.getByLabel("Core skills").fill("SQL Server\nSSIS\nPython\nAzure Data Factory");
  await page.getByLabel("Preferred locations").fill("Metz\nNancy\nLuxembourg\nGrand Est\nRemote France");
  await page.getByLabel("Languages").fill("French (native)\nEnglish (professional)");
  await page.getByLabel("Contract types").fill("CDI");
  await page.getByRole("button", { name: "Save reviewed profile" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Core skills")).toHaveValue(/SSIS/);
  await expect(page.getByText("Profile version 2")).toBeVisible();

  await page.locator('input[type=file]').setInputFiles({ name: "cv.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic test CV\nData engineer. SQL Server, SSIS, Python.") });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(/Resume stored/)).toBeVisible();
  await expect(page.getByText("cv.txt")).toBeVisible();
  const download = await page.request.get(await page.getByRole("link", { name: /Original/ }).first().getAttribute("href") ?? "");
  expect(download.ok()).toBe(true); expect(await download.text()).toContain("Synthetic test CV");
  const pdf = await new Promise<Buffer>(resolve => { const document = new PDFDocument(); const chunks: Buffer[] = []; document.on("data", chunk => chunks.push(chunk as Buffer)); document.on("end", () => resolve(Buffer.concat(chunks))); document.text("Synthetic PDF CV. Data engineer: SSIS, SQL Server, Python."); document.end(); });
  await page.locator('input[type=file]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("cv.pdf")).toBeVisible();
  const rejected = await page.request.post("/api/resume/upload", { multipart: { file: { name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not a pdf") } }, headers: { origin: new URL(page.url()).origin } });
  expect(rejected.status()).toBe(400);
});

test("a search profile can be created from a template, deactivated and reactivated", async ({ page }) => {
  await signIn(page); await page.goto("/search-profiles");
  await page.getByRole("button", { name: "Data & integration" }).click();
  await expect(page.getByLabel("Target job titles")).toHaveValue(/Développeur SSIS/);
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByText("Search profile created")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Data & integration/ })).toBeVisible();
  await page.getByRole("button", { name: "Deactivate" }).click(); await expect(page.getByText("Inactive")).toBeVisible();
  await page.getByRole("button", { name: "Activate" }).click(); await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test("a source can be configured, validated and left clearly unchecked offline", async ({ page }) => {
  await signIn(page); await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "France Travail" })).toBeVisible();
  await expect(page.getByText(/FRANCE_TRAVAIL_CLIENT_ID/)).toBeVisible();
  const greenhouse = page.locator(".provider-card", { has: page.getByRole("heading", { name: "Greenhouse" }) });
  await greenhouse.getByRole("button", { name: "Add Doctolib" }).click();
  await expect(greenhouse.getByLabel(/Greenhouse board names/)).toHaveValue("doctolib");
  await greenhouse.getByLabel(/Greenhouse board names/).fill("bad slug with spaces!");
  await greenhouse.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Board names may only contain" })).toBeVisible();
  await greenhouse.getByLabel(/Greenhouse board names/).fill("https://boards.greenhouse.io/doctolib/jobs/123");
  await greenhouse.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Greenhouse saved.")).toBeVisible();
  await page.reload(); await expect(page.locator(".provider-card", { has: page.getByRole("heading", { name: "Greenhouse" }) }).getByLabel(/Greenhouse board names/)).toHaveValue("doctolib");
  await expect(page.getByText("LinkedIn")).toBeVisible();
});

test("an imported posting is scored with evidence, can be saved, dismissed and restored", async ({ page }) => {
  await signIn(page); await page.goto("/jobs");
  await page.getByText("Import a posting you found elsewhere").click();
  await page.getByRole("tab", { name: "Paste the text" }).click();
  const panel = page.locator("details.panel");
  await panel.getByLabel("Title").fill(job.title); await panel.getByLabel("Company").fill(job.company); await panel.getByLabel("Location").fill(job.location);
  await panel.getByLabel("Original posting URL").fill("https://careers.example.test/jobs/1"); await panel.getByLabel("Job description").fill(job.description);
  await panel.getByRole("button", { name: "Import and score" }).click();
  await expect(page.getByText("Job imported, scored and de-duplicated.")).toBeVisible();
  const row = page.locator(".job-row", { hasText: job.title });
  await expect(row).toBeVisible(); await expect(row.getByText(/Strong Match|Good Match/)).toBeVisible();

  await row.getByRole("link", { name: job.title }).click();
  await expect(page.getByRole("heading", { name: "Why this score" })).toBeVisible();
  await expect(page.getByText("Skills supported by your profile")).toBeVisible();
  await expect(page.locator(".pill-ok", { hasText: "SSIS" })).toBeVisible();
  await expect(page.getByText(/is about \d+ km from your preferred|Location matches/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open the application page/ })).toHaveAttribute("href", "https://careers.example.test/jobs/1");

  await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByText("Saved to your pipeline.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click(); await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await page.goto("/jobs"); await expect(page.getByRole("link", { name: job.title })).toHaveCount(0);
  await page.getByRole("tab", { name: "Dismissed" }).click(); await expect(page.getByRole("link", { name: job.title })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).first().click(); await page.getByRole("tab", { name: "Open" }).click(); await expect(page.getByRole("link", { name: job.title })).toBeVisible();
  await page.getByLabel("Minimum match").selectOption("80"); await expect(page.locator(".job-row", { hasText: job.title })).toBeVisible();
  await page.getByLabel("Employer", { exact: true }).fill("nothing-like-this"); await expect(page.getByText("No opportunities match")).toBeVisible();
});

test("the pipeline tracks stage, notes, follow-up and interviews, and the dashboard reflects them", async ({ page }) => {
  await signIn(page); await page.goto("/applications");
  const card = page.locator(".kanban-card", { hasText: job.title }); await expect(card).toBeVisible();
  await expect(page.getByRole("region", { name: /^Saved/ }).locator(".kanban-card", { hasText: job.title })).toBeVisible();
  await card.getByLabel(`Stage for ${job.title}`).selectOption("APPLIED");
  await expect(page.getByRole("region", { name: /^Applied/ }).locator(".kanban-card", { hasText: job.title })).toBeVisible();
  await page.getByRole("button", { name: "Notes & follow-up" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Next action", { exact: true }).fill("Follow up with the recruiter");
  await drawer.getByLabel("Follow-up date").fill("2026-12-01T09:00");
  await drawer.getByRole("button", { name: "Add interview" }).click();
  const future = new Date(Date.now() + 7 * 86_400_000); future.setHours(14, 0, 0, 0); const pad = (n: number) => String(n).padStart(2, "0");
  await drawer.getByLabel("Interview 1", { exact: true }).fill(`${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T14:00`);
  await drawer.getByLabel("Notes", { exact: true }).fill("Spoke to HR on the phone.");
  await drawer.getByRole("button", { name: "Update application" }).click(); await expect(drawer.getByText("Application saved.")).toBeVisible();
  await page.keyboard.press("Escape"); await page.reload();
  await page.getByRole("button", { name: "Notes & follow-up" }).click();
  await expect(page.getByRole("dialog").locator("textarea")).toHaveValue("Spoke to HR on the phone.");
  await expect(page.getByRole("dialog").getByText("Applied", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  // Drag and drop to another column.
  await page.locator(".kanban-card", { hasText: job.title }).dragTo(page.getByRole("region", { name: /^Interview/ }));
  await expect(page.getByRole("region", { name: /^Interview/ }).locator(".kanban-card", { hasText: job.title })).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".stat", { hasText: "Applications sent" }).locator("strong")).toHaveText("1");
  await expect(page.locator(".stat", { hasText: "Upcoming interviews" }).locator("strong")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "Interviews and follow-ups" })).toBeVisible();
});

test("settings persist, validate and explain what is not configured", async ({ page }) => {
  await signIn(page); await page.goto("/settings");
  await expect(page.getByText("Scores and notifications work without AI")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send test email" })).toBeDisabled();
  await page.getByLabel("Time", { exact: true }).fill("07:45");
  await page.getByLabel("Maximum jobs per digest").fill("8");
  await page.getByRole("button", { name: "Save settings" }).click(); await expect(page.getByText("Settings saved.")).toBeVisible();
  await page.reload(); await expect(page.getByLabel("Time", { exact: true })).toHaveValue("07:45"); await expect(page.getByLabel("Maximum jobs per digest")).toHaveValue("8");
  const exported = await page.request.get("/api/privacy/export"); expect(exported.ok()).toBe(true);
  const data = await exported.json() as { data: { email: string; applications: unknown[] } }; expect(data.data.email).toBe(owner.email); expect(data.data.applications.length).toBe(1);
});

test("a manual search without a configured source explains what is missing", async ({ page }) => {
  await signIn(page); await page.goto("/runs");
  await page.getByRole("button", { name: "Run job search" }).click();
  await expect(page.getByText(/Search (queued|running)/i).or(page.getByText(/already|queued/i)).first()).toBeVisible();
  await expect(page.getByText(/No job source is enabled/)).toBeVisible({ timeout: 30_000 });
});
