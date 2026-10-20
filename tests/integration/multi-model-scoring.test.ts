const scoringEnv = { OPENROUTER_API_KEY: "sk-or-test", MAX_AI_ANALYSES_PER_DAY: "200", MAX_LLM_COST_PER_DAY: "5", AI_SCORING_REASONING_EFFORT: "low" };
Object.assign(process.env, scoringEnv);
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { rubric } from "@/ai/scoring";
import { database, describeDb, resetDatabase, seedOwner } from "@/tests/integration/helpers";

// Simulated OpenRouter: the public catalog plus a chat endpoint whose answer is scripted per model.
const SONNET = "anthropic/claude-sonnet-5.5", FABLE = "anthropic/claude-fable-5.1", ASTRA = "openai/gpt-6-astra", LUNA = "openai/gpt-6-luna";
const catalogIds = [SONNET, "anthropic/claude-sonnet-5", "openai/gpt-6.1-sol", FABLE, "anthropic/claude-fable-5", "anthropic/claude-opus-5.5", ASTRA, LUNA, "openai/gpt-6-sol"];
const catalog = { data: catalogIds.map(id => ({ id, context_length: 1_000_000, pricing: { prompt: "0.000002", completion: "0.00001" }, top_provider: { max_completion_tokens: 128_000 }, supported_parameters: ["max_tokens", "reasoning", "response_format", "structured_outputs"] })) };
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
let script: (model: string, call: number) => Reply; let chatCalls: { model: string; body: Record<string, unknown> }[] = [];
const scores: Record<string, number> = { [SONNET]: 92, [FABLE]: 88, [ASTRA]: 95, [LUNA]: 81 };
const answer = (model: string, score: number): Reply => ({ status: 200, body: { model, choices: [{ message: { content: JSON.stringify({ dimensions: Object.fromEntries(rubric.map(item => [item.key, { score, reasoning: "Stated skills match the posting." }])), requiredQualifications: [{ requirement: "SSIS", status: "met", evidence: "coreSkills: SSIS" }], preferredQualifications: [], matchedSkills: ["SSIS", "Invented Skill"], missingInformation: [], summary: "Strong data-integration fit.", recommendation: "APPLY" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1_500, completion_tokens: 500, cost: 0.002 } } });
const byModel = (model: string) => answer(model, scores[model] ?? 70);

const description = "Compétences requises : SQL Server, SSIS, Python. 3 ans d'expérience. CDI.";
const greenhouseJobs = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `Ingénieur Data ${index + 1} (H/F)`, absolute_url: `https://boards.greenhouse.io/acme/jobs/${index + 1}`, location: { name: "Metz" }, content: description, first_published: "2026-10-10T08:00:00Z" }));
let boardSize = 2; let leverJobs: unknown[] = []; let calls: string[] = [];
function stub() {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url === "https://openrouter.ai/api/v1/models") return new Response(JSON.stringify(catalog), { status: 200 });
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>; const model = String(body.model); chatCalls.push({ model, body });
      const reply = script(model, chatCalls.filter(call => call.model === model).length); return new Response(JSON.stringify(reply.body), { status: reply.status, headers: reply.headers });
    }
    if (url.includes("api.lever.co")) return new Response(JSON.stringify(leverJobs), { status: 200 });
    if (url.includes("/jobs?content=true")) return new Response(JSON.stringify({ jobs: greenhouseJobs(boardSize) }), { status: 200 });
    return new Response(JSON.stringify({ name: "Acme" }), { status: 200 });
  }));
}
async function enable(...ids: ("greenhouse" | "lever")[]) {
  const db = await database(); const { ensureProviders } = await import("@/lib/services/providers"); await ensureProviders();
  for (const id of ids) await db.providerSetting.update({ where: { id }, data: { enabled: true, rateLimitMs: 100, config: { boards: ["acme"] } } });
}
async function runOnce() {
  const { createSearchRun, processSearchRun } = await import("@/lib/services/search"); const db = await database(); const run = await createSearchRun("MANUAL");
  await processSearchRun(run.id); return db.searchRun.findUniqueOrThrow({ where: { id: run.id }, include: { providerRuns: true } });
}

// Later test files must not inherit multi-model scoring.
afterAll(() => { for (const key of Object.keys(scoringEnv)) delete process.env[key]; });

describeDb("multi-model AI scoring in a search run", () => {
  beforeEach(async () => {
    await resetDatabase(); await seedOwner(); boardSize = 2; leverJobs = []; calls = []; chatCalls = []; script = byModel; stub();
    (await import("@/ai/openrouter")).resetCatalogCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("scores each stored job with the three primary models, stores every score and the actual model, and ranks by the average", async () => {
    await enable("greenhouse"); const db = await database(); const run = await runOnce();
    expect(run).toMatchObject({ status: "FINISHED", jobsNew: 2, jobsAnalyzed: 2 });
    expect(chatCalls.map(call => call.model).sort()).toEqual([FABLE, FABLE, SONNET, SONNET, ASTRA, ASTRA]);
    expect(chatCalls.every(call => !("temperature" in call.body) && (call.body.response_format as { type: string }).type === "json_schema")).toBe(true);
    const scorings = await db.jobScoring.findMany({ include: { scores: { orderBy: { slot: "asc" } } } });
    expect(scorings).toHaveLength(2);
    for (const scoring of scorings) {
      expect(scoring).toMatchObject({ status: "COMPLETE", slotsPlanned: 3, slotsScored: 3, inputTokens: 4_500, outputTokens: 1_500 }); expect(Number(scoring.averageScore)).toBe(91.67); expect(Number(scoring.costUsd)).toBeCloseTo(0.006, 6);
      expect(scoring.scores.map(score => [score.slot, score.model, score.score, score.status, score.fallbackUsed])).toEqual([[1, SONNET, 92, "SCORED", false], [2, FABLE, 88, "SCORED", false], [3, ASTRA, 95, "SCORED", false]]);
      expect((scoring.scores[0]!.result as { assessment: { matchedSkills: string[] } }).assessment.matchedSkills).toEqual(["SSIS"]); // invented skills are dropped
    }
    const jobs = await db.job.findMany(); for (const job of jobs) { expect(Number(job.aiAverageScore)).toBe(91.67); expect(job.matchScore).toBe(92); expect(job.rankScore).toBe(92); }
    const usage = await db.aIUsage.findMany(); expect(usage).toHaveLength(6); expect(usage.every(row => row.status === "COMPLETED" && row.provider === "openrouter" && row.operation === "JOB_SCORING" && Number(row.estimatedCost) === 0.002)).toBe(true);
  });

  it("does not rescore an unchanged job and profile, but does when the job's text changes", async () => {
    await enable("greenhouse"); await runOnce(); expect(chatCalls).toHaveLength(6);
    await runOnce(); expect(chatCalls).toHaveLength(6);
    const db = await database(); await db.job.updateMany({ data: { matchScore: null } });
    await runOnce(); expect(chatCalls).toHaveLength(6); // the stored scoring is reused, not recomputed
    const { scoreWithModels } = await import("@/lib/services/scoring"); const { loadMatchingContext } = await import("@/lib/services/matching"); const { normalizedFromStored } = await import("@/lib/services/jobs"); const { scoreJob } = await import("@/matching/score");
    const context = (await loadMatchingContext())!; const stored = await db.job.findFirstOrThrow({ include: { sources: true } }); const normalized = { ...normalizedFromStored(stored), descriptionClean: `${description} Kubernetes souhaité.` };
    const outcome = await scoreWithModels(stored.id, normalized, scoreJob(context.candidate, normalized, context.profiles), context);
    expect(outcome.status).toBe("COMPLETE"); expect(chatCalls).toHaveLength(9); expect(await db.jobScoring.count({ where: { jobId: stored.id } })).toBe(2);
  });

  it("falls back within a slot after retrying a rate limit, and records the model that actually answered", async () => {
    script = model => model === ASTRA ? { status: 429, body: { error: { message: "Rate limit exceeded" } }, headers: { "retry-after": "1" } } : byModel(model);
    boardSize = 1; await enable("greenhouse"); const db = await database(); await runOnce();
    expect(chatCalls.filter(call => call.model === ASTRA)).toHaveLength(2); expect(chatCalls.filter(call => call.model === LUNA)).toHaveLength(1);
    const scoring = await db.jobScoring.findFirstOrThrow({ include: { scores: { orderBy: { slot: "asc" } } } });
    expect(scoring.status).toBe("COMPLETE"); expect(scoring.scores[2]).toMatchObject({ primaryModel: ASTRA, model: LUNA, score: 81, fallbackUsed: true });
    expect((scoring.scores[2]!.attempts as { code?: string }[]).map(attempt => attempt.code ?? "OK")).toEqual(["RATE_LIMIT", "RATE_LIMIT", "OK"]);
    expect(Number(scoring.averageScore)).toBe(87); // (92 + 88 + 81) / 3
    expect(await db.aIUsage.count({ where: { status: "FAILED" } })).toBe(2); // unbilled 429s no longer count against the budget
  });

  it("averages the models that answered and shows reduced coverage when a whole slot fails", async () => {
    script = model => model.startsWith("openai/") ? { status: 404, body: { error: { message: "No endpoints found" } } } : byModel(model);
    boardSize = 1; await enable("greenhouse"); const db = await database(); const run = await runOnce();
    const scoring = await db.jobScoring.findFirstOrThrow({ include: { scores: { orderBy: { slot: "asc" } } } });
    expect(scoring).toMatchObject({ status: "PARTIAL", slotsScored: 2, slotsPlanned: 3 }); expect(Number(scoring.averageScore)).toBe(90);
    expect(scoring.scores[2]).toMatchObject({ status: "FAILED", score: null }); expect((scoring.scores[2]!.attempts as unknown[]).length).toBe(3);
    expect(run.jobsAnalyzed).toBe(1); expect((await db.job.findFirstOrThrow()).matchScore).toBe(90);
  });

  it("never invents a score when no model answers, and stops after repeated total failures", async () => {
    script = () => ({ status: 404, body: { error: { message: "No endpoints found" } } });
    boardSize = 3; await enable("greenhouse"); const db = await database(); const run = await runOnce();
    expect(run.status).toBe("FINISHED"); expect(run.jobsAnalyzed).toBe(0); expect(JSON.stringify(run.errors)).toContain("two jobs in a row");
    expect(await db.jobScoring.count({ where: { status: "FAILED" } })).toBe(2); expect(await db.job.count({ where: { matchScore: { not: null } } })).toBe(0);
    expect(await db.job.count({ where: { rankScore: { not: null } } })).toBe(3); // rule-based scores remain
  });

  it("stops scoring at the daily budget and keeps rule-based results", async () => {
    await enable("greenhouse"); const { saveSettings } = await import("@/lib/services/settings"); await saveSettings({ ai: { maxCostPerDay: 0.01 } }); const db = await database();
    const run = await runOnce();
    expect(chatCalls).toHaveLength(0); expect(JSON.stringify(run.errors)).toContain("Daily AI cost limit reached");
    const scoring = await db.jobScoring.findFirstOrThrow(); expect(scoring.status).toBe("FAILED"); expect(scoring.averageScore).toBeNull(); expect(await db.jobScoring.count()).toBe(1);
  });

  it("searches and scores a posting found on two sources only once", async () => {
    boardSize = 1; leverJobs = [{ id: "lever-1", text: "Ingénieur Data 1 (H/F)", hostedUrl: "https://jobs.lever.co/acme/lever-1", descriptionPlain: description, categories: { location: "Metz", commitment: "CDI" }, createdAt: Date.parse("2026-10-10T08:00:00Z") }];
    await enable("greenhouse", "lever"); const db = await database(); const run = await runOnce();
    expect(run.providerRuns.map(item => item.providerId).sort()).toEqual(["greenhouse", "lever"]);
    expect(await db.job.count()).toBe(1); expect(await db.jobPostingSource.count()).toBe(2); expect(chatCalls).toHaveLength(3); expect(await db.jobScoring.count()).toBe(1);
  });

  it("searches only the sources a profile selects, unless another profile uses every source", async () => {
    const db = await database(); const profile = await db.searchProfile.findFirstOrThrow(); await db.searchProfile.update({ where: { id: profile.id }, data: { data: { ...(profile.data as object), providers: ["lever"] } } });
    await enable("greenhouse", "lever"); let run = await runOnce(); expect(run.providerRuns.map(item => item.providerId)).toEqual(["lever"]);
    const { searchProfileInputSchema } = await import("@/lib/schemas"); const all = searchProfileInputSchema.parse({ name: "Everything", targetTitles: ["Data Engineer"], providers: [] });
    await db.searchProfile.create({ data: { userId: profile.userId, name: all.name, enabled: true, data: all } });
    run = await runOnce(); expect(run.providerRuns.map(item => item.providerId).sort()).toEqual(["greenhouse", "lever"]);
  });

  it("a manual re-run replaces the stored scoring instead of adding a duplicate", async () => {
    boardSize = 1; await enable("greenhouse"); const db = await database(); await runOnce(); const before = await db.jobScoring.findFirstOrThrow();
    scores[SONNET] = 58; try { const { processTask } = await import("@/workers/processor"); await processTask("ANALYZE_JOB", { id: before.jobId }); } finally { scores[SONNET] = 92; }
    const after = await db.jobScoring.findMany(); expect(after).toHaveLength(1); expect(after[0]!.id).not.toBe(before.id); expect(Number(after[0]!.averageScore)).toBe(80.33);
    expect((await db.job.findFirstOrThrow()).matchScore).toBe(80);
  });
});

describeDb("AI budget accounting", () => {
  beforeEach(async () => { await resetDatabase(); await seedOwner(); });
  it("counts finished calls at their actual cost, in-flight calls at their reservation, and unbilled failures not at all", async () => {
    const { saveSettings } = await import("@/lib/services/settings"); await saveSettings({ ai: { maxCostPerDay: 0.05 } });
    const { completeAiCall, releaseAiCall, reserveAiCall } = await import("@/lib/services/usage");
    const call = { provider: "openrouter", model: SONNET, operation: "JOB_SCORING", inputTokens: 1_000, maxOutputTokens: 3_800, pricing: { inputPerMillion: 2, outputPerMillion: 10 } }; // reserves $0.04
    const first = await reserveAiCall(call); await expect(reserveAiCall(call)).rejects.toThrow("Daily AI cost limit reached");
    await completeAiCall(first, { inputTokens: 900, outputTokens: 200, costUsd: 0.0038 });
    const second = await reserveAiCall(call); await releaseAiCall(second, false);
    const third = await reserveAiCall(call); await releaseAiCall(third, true);
    await expect(reserveAiCall(call)).rejects.toThrow("Daily AI cost limit reached"); // the possibly-billed third call still counts
  });
});
