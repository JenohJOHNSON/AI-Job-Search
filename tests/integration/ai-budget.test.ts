Object.assign(process.env, { AI_PROVIDER: "openai", AI_MODEL: "test-model", OPENAI_API_KEY: "test-key", AI_INPUT_PRICE_PER_MILLION: "1", AI_OUTPUT_PRICE_PER_MILLION: "2", MAX_AI_ANALYSES_PER_DAY: "50", MAX_LLM_COST_PER_DAY: "5" });
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { database, describeDb, resetDatabase, seedOwner } from "@/tests/integration/helpers";

const dimension = { score: 80, reasoning: "Because of evidence in the profile." };
const analysis = (score: number) => ({ overallMatchScore: score, confidence: 0.8, summary: "Good fit.", dimensions: { roleMatch: dimension, skillsMatch: dimension, experienceMatch: dimension, industryMatch: dimension, locationMatch: dimension, compensationMatch: dimension, seniorityMatch: dimension, careerGrowthMatch: dimension }, matchingSkills: ["SSIS", "Invented Skill"], missingSkills: [], transferableSkills: [], strongPoints: [], weakPoints: [], hardRequirementsMet: [], hardRequirementsMissing: [], potentialRedFlags: [], applicationRecommendation: "APPLY" });
const description = "Compétences requises : SQL Server, SSIS, Python. 3 ans d'expérience. CDI.";
let aiCalls = 0; let aiResponse: () => Response;
const jobs = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `Ingénieur Data ${index + 1} (H/F)`, absolute_url: `https://boards.greenhouse.io/acme/jobs/${index + 1}`, location: { name: "Metz" }, content: description, first_published: "2026-10-10T08:00:00Z" }));
function stub(count: number) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const target = String(url);
    if (target.includes("api.openai.com")) { aiCalls++; return aiResponse(); }
    if (target.includes("/jobs?content=true")) return new Response(JSON.stringify({ jobs: jobs(count) }), { status: 200 });
    return new Response(JSON.stringify({ name: "Acme" }), { status: 200 });
  }));
}
const completion = (score: number, usage = { prompt_tokens: 1000, completion_tokens: 500 }) => () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis(score)) } }], usage }), { status: 200 });
async function runOnce() {
  const { createSearchRun, processSearchRun } = await import("@/lib/services/search"); const db = await database(); const run = await createSearchRun("MANUAL");
  await processSearchRun(run.id); return db.searchRun.findUniqueOrThrow({ where: { id: run.id } });
}
async function setup(count: number) {
  await resetDatabase(); await seedOwner(); const db = await database(); const { ensureProviders } = await import("@/lib/services/providers"); await ensureProviders();
  await db.providerSetting.update({ where: { id: "greenhouse" }, data: { enabled: true, config: { boards: ["acme"] } } }); stub(count);
}

describeDb("AI usage controls", () => {
  beforeEach(() => { aiCalls = 0; aiResponse = completion(90); });
  afterEach(() => vi.unstubAllGlobals());

  it("stops spending at the owner's daily request limit while keeping rule-based results", async () => {
    await setup(4); const { saveSettings } = await import("@/lib/services/settings"); await saveSettings({ ai: { maxAnalysesPerDay: 2 } }); const db = await database();
    const run = await runOnce();
    expect(aiCalls).toBe(2); expect(run).toMatchObject({ status: "FINISHED", jobsAnalyzed: 2, jobsNew: 4 }); expect(JSON.stringify(run.errors)).toContain("Daily AI request limit reached");
    expect(await db.aIUsage.count({ where: { status: "COMPLETED" } })).toBe(2);
    expect(await db.job.count({ where: { rankScore: { not: null } } })).toBe(4); expect(await db.job.count({ where: { matchScore: { not: null } } })).toBe(2);
  });
  it("accounts for tokens and cost exactly from the configured prices", async () => {
    await setup(1); const db = await database(); await runOnce();
    const usage = await db.aIUsage.findFirstOrThrow(); expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 500, status: "COMPLETED" }); expect(Number(usage.estimatedCost)).toBeCloseTo(1000 * 1 / 1e6 + 500 * 2 / 1e6, 8);
    const analysisRow = await db.jobAnalysis.findFirstOrThrow(); expect(Number(analysisRow.estimatedCost)).toBeCloseTo(0.002, 8);
    expect((analysisRow.result as { matchingSkills: string[] }).matchingSkills).toEqual(["SSIS"]); // skills the profile does not list are discarded
  });
  it("caches analyses: re-running the same search does not call the model again", async () => {
    await setup(2); await runOnce(); expect(aiCalls).toBe(2); await runOnce(); expect(aiCalls).toBe(2);
  });
  it("rejects malformed model output without losing the discovered jobs", async () => {
    await setup(1); aiResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"overallMatchScore\": 150}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    const db = await database(); const run = await runOnce(); expect(run.status).toBe("FINISHED"); expect(await db.job.count()).toBe(1); expect(await db.jobAnalysis.count()).toBe(0); expect(JSON.stringify(run.errors)).toContain("AI_PROVIDER");
  });
  it("never lets the model lift a job past a hard blocker", async () => {
    await setup(1); const db = await database(); await runOnce(); const job = await db.job.findFirstOrThrow();
    const profile = await db.candidateProfile.findFirstOrThrow(); await db.candidateProfile.update({ where: { id: profile.id }, data: { version: { increment: 1 }, data: { ...(profile.data as object), excludedKeywords: ["SSIS"] } } });
    aiResponse = completion(97); const { processTask } = await import("@/workers/processor"); await processTask("ANALYZE_JOB", { id: job.id });
    const after = await db.job.findFirstOrThrow(); expect(after.matchScore).toBe(97); expect(after.rankScore).toBeLessThanOrEqual(35);
  });
});
