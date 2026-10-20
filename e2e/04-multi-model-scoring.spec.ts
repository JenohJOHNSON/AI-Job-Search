import http from "node:http";
import { expect, test } from "@playwright/test";
import { signIn } from "./support";

// The whole multi-model path through the real interface, API, queue, worker and database, against a local fake OpenRouter
// (no key, no cost). Run it with `npm run e2e:scoring`; the regular `npm run e2e` skips it.
const fakePort = 3199;
test.skip(!process.env.OPENROUTER_BASE_URL?.startsWith(`http://127.0.0.1:${fakePort}`), "Runs with npm run e2e:scoring against a local fake OpenRouter.");

const dimensions = ["skills", "experience", "requirements", "seniority", "workStyle", "location", "overall"];
// GPT-6 Astra is rate limited, so slot 3 must retry it once and then fall back to GPT-6 Luna.
const scripted: Record<string, number | "rate-limited"> = { "anthropic/claude-sonnet-5.5": 92, "anthropic/claude-fable-5.1": 88, "openai/gpt-6-astra": "rate-limited", "openai/gpt-6-luna": 95 };
const catalog = ["anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-5", "openai/gpt-6.1-sol", "anthropic/claude-fable-5.1", "anthropic/claude-fable-5", "anthropic/claude-opus-5.5", "openai/gpt-6-astra", "openai/gpt-6-luna", "openai/gpt-6-sol"]
  .map(id => ({ id, context_length: 1_000_000, pricing: { prompt: "0.000002", completion: "0.00001" }, top_provider: { max_completion_tokens: 128_000 }, supported_parameters: ["max_tokens", "reasoning", "response_format", "structured_outputs"] }));
const requests: { model: string; temperature: unknown; schema: unknown; system: string; user: string }[] = [];
let server: http.Server;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => { response.writeHead(status, { "content-type": "application/json", ...headers }); response.end(JSON.stringify(payload)); };
      if (request.url === "/api/v1/models") return send(200, { data: catalog });
      if (request.url !== "/api/v1/chat/completions" || request.headers.authorization !== "Bearer e2e-fake-key") return send(401, { error: { message: "unexpected request" } });
      const parsed = JSON.parse(body) as { model: string; temperature?: unknown; response_format?: unknown; messages: { content: string }[] };
      requests.push({ model: parsed.model, temperature: parsed.temperature, schema: parsed.response_format, system: parsed.messages[0]!.content, user: parsed.messages[1]!.content });
      const plan = scripted[parsed.model];
      if (plan === "rate-limited") return send(429, { error: { message: "Rate limit exceeded" } }, { "retry-after": "1" });
      if (plan === undefined) return send(404, { error: { message: "No endpoints found" } });
      const content = { dimensions: Object.fromEntries(dimensions.map(key => [key, { score: plan, reasoning: `${parsed.model} reasoning for ${key}.` }])), requiredQualifications: [{ requirement: "SSIS", status: "met", evidence: "coreSkills: SSIS" }, { requirement: "Kubernetes", status: "met", evidence: "Five years of Kubernetes" }], preferredQualifications: [], matchedSkills: ["SSIS", "Kubernetes"], missingInformation: ["Salary is not stated."], summary: `Summary from ${parsed.model}.`, recommendation: "APPLY" };
      // A short delay keeps the in-progress state visible.
      setTimeout(() => send(200, { model: parsed.model, choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 2_000, completion_tokens: 600, cost: 0.0052 } }), 4_000);
    });
  });
  await new Promise<void>(resolve => server.listen(fakePort, "127.0.0.1", resolve));
});
test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

test("a job is scored by three models from the job page, with a tracked fallback, and ranked by the average", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page); const origin = new URL(page.url()).origin; const headers = { origin };
  const profile = await (await page.request.get("/api/profile")).json() as { profile: Record<string, unknown> };
  expect((await page.request.put("/api/profile", { headers, data: { ...profile.profile, location: "Metz", yearsExperience: 5, targetRoles: ["Data Engineer"], coreSkills: ["SQL Server", "SSIS", "Python"], locations: ["Metz", "Nancy"], languages: ["French (native)"] } })).ok()).toBe(true);
  const profiles = await (await page.request.get("/api/search/profiles")).json() as { profiles: unknown[] };
  if (!profiles.profiles.length) expect((await page.request.post("/api/search/profiles", { headers, data: { name: "Scoring e2e", targetTitles: ["Data Engineer"], locations: ["Metz"], remotePreferences: ["remote", "hybrid", "onsite"] } })).ok()).toBe(true);
  const title = `Ingénieur Data scoring ${Date.now()}`;
  const created = await page.request.post("/api/jobs", { headers, data: { title, companyName: "Exemple Scoring (test data)", location: "Metz", sourceUrl: `https://careers.example.test/scoring/${Date.now()}`, descriptionClean: "Synthetic test posting. Compétences requises : SQL Server, SSIS, Python. 3 ans d'expérience. CDI. Télétravail partiel possible." } });
  expect(created.ok()).toBe(true); const job = await created.json() as { id: string };

  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole("heading", { name: "Not scored by the AI models yet" })).toBeVisible();
  await page.getByRole("button", { name: "Run multi-model scoring" }).first().click();
  await expect(page.getByText(/Scoring queued/)).toBeVisible();
  const panel = page.locator("section.panel", { has: page.getByRole("heading", { name: "Multi-model AI score" }) });
  await expect(panel.getByText(/Scoring… \d of 3 models answered/)).toBeVisible({ timeout: 30_000 }); // progress while the models answer
  await expect(panel.getByText("All 3 models scored")).toBeVisible({ timeout: 60_000 });

  const rows = panel.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("Claude Sonnet 5.5"); await expect(rows.nth(0).locator(".model-score")).toHaveText("92");
  await expect(rows.nth(1)).toContainText("Claude Fable 5.1"); await expect(rows.nth(1).locator(".model-score")).toHaveText("88");
  await expect(rows.nth(2)).toContainText("GPT-6 Luna"); await expect(rows.nth(2)).toContainText("replaced GPT-6 Astra"); await expect(rows.nth(2)).toContainText("Scored · fallback"); await expect(rows.nth(2).locator(".model-score")).toHaveText("95");
  await expect(rows.nth(3)).toContainText("Final average of 3 valid scores"); await expect(rows.nth(3).locator(".model-score")).toHaveText("91.67");
  await expect(page.locator(".detail-hero .score-label")).toContainText("AI ×3"); await expect(page.locator(".detail-hero .score-value")).toContainText("92");

  // Each model's explanation, and the guard against claims the profile does not support.
  await panel.getByText(/Slot 3 · GPT-6 Luna/).click();
  const detail = panel.locator("details.model-detail").nth(2);
  await expect(detail.getByText("Summary from openai/gpt-6-luna.")).toBeVisible();
  await expect(detail.getByText(/Kubernetes — unclear \(the cited evidence is not in your profile\)/)).toBeVisible();
  await expect(detail.getByText("GPT-6 Astra: failed, rate limited")).toBeVisible(); await expect(detail.getByText("GPT-6 Astra (retry): failed, rate limited")).toBeVisible();

  // Every model saw exactly the same request, with structured output and no temperature.
  const scored = requests.filter(request => request.user.includes(title));
  expect(scored.map(request => request.model).sort()).toEqual(["anthropic/claude-fable-5.1", "anthropic/claude-sonnet-5.5", "openai/gpt-6-astra", "openai/gpt-6-astra", "openai/gpt-6-luna"]);
  expect(new Set(scored.map(request => request.system + request.user)).size).toBe(1); expect(scored.every(request => request.temperature === undefined && request.schema)).toBe(true);

  // The list ranks by the AI average and says how many models produced it.
  await page.goto("/jobs?sort=ai");
  const row = page.locator(".job-row", { hasText: title });
  await expect(row.getByText("AI average 91.67 from 3 models.")).toBeVisible(); await expect(row.locator(".score-label")).toContainText("AI ×3");
  await expect(page.getByLabel("Sort by")).toHaveValue("ai");
});
