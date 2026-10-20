import { defineConfig, devices } from "@playwright/test";
try { process.loadEnvFile?.(); } catch { /* no .env file */ }

// Browser tests drive a running web service (and worker) over HTTP:  BASE_URL=http://localhost:3000 npx playwright test
// They use deterministic manual data only, never live job boards. Start from an empty database (CI does).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-GB", timezoneId: "Europe/Paris" },
  projects: [
    { name: "desktop", testIgnore: /03-responsive/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: /03-responsive/, dependencies: ["desktop"], use: { ...devices["Pixel 7"] } }
  ]
});
