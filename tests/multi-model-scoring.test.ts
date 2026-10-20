import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatError, modelCatalog, resetCatalogCache, type ChatRequest, type ChatResult, type ModelCatalog } from "@/ai/openrouter";
import { averageScore, checkAgainstProfile, modelScore, parseAssessment, rubric, runEnsemble, scoringPreferences, scoringPrompt, type Assessment, type ScoringDeps } from "@/ai/scoring";
import { searchProfileInputSchema } from "@/lib/schemas";
import { candidate, job, searchProfile, strongDescription } from "@/tests/fixtures/candidate";

const SONNET = "anthropic/claude-sonnet-5.5", SONNET5 = "anthropic/claude-sonnet-5", FABLE = "anthropic/claude-fable-5.1", FABLE5 = "anthropic/claude-fable-5", ASTRA = "openai/gpt-6-astra", LUNA = "openai/gpt-6-luna";
const slots = [{ slot: 1, models: [SONNET, SONNET5] }, { slot: 2, models: [FABLE, FABLE5] }, { slot: 3, models: [ASTRA, LUNA] }];
const catalog: ModelCatalog = new Map([SONNET, SONNET5, FABLE, FABLE5, ASTRA, LUNA].map(id => [id, { id, contextLength: 1_000_000, maxCompletionTokens: 128_000, inputPerMillion: 2, outputPerMillion: 10, parameters: new Set(["max_tokens", "reasoning", "response_format", "structured_outputs"]) }]));
const dimensions = (score: number) => Object.fromEntries(rubric.map(item => [item.key, { score, reasoning: "Based on the stated skills." }]));
const answer = (score: number, extra: Record<string, unknown> = {}) => JSON.stringify({ dimensions: dimensions(score), requiredQualifications: [], preferredQualifications: [], matchedSkills: ["SSIS"], missingInformation: [], summary: "Strong fit on the data stack.", recommendation: "APPLY", ...extra });
const ok = (model: string, score: number, extra?: Record<string, unknown>): ChatResult => ({ content: answer(score, extra), model, inputTokens: 1_200, outputTokens: 400, costUsd: 0.004, finishReason: "stop" });
const prompt = scoringPrompt(candidate, scoringPreferences([searchProfile]), job({ descriptionClean: strongDescription }));

/** Scripted OpenRouter: each model answers from its own queue, in order. */
function harness(script: Record<string, (ChatResult | ChatError)[]>, overrides: Partial<ScoringDeps> = {}) {
  const requests: ChatRequest[] = []; const ledger = { reserved: 0, completed: 0, released: 0, keptReserved: 0 };
  const deps: ScoringDeps = {
    catalog, sleep: async () => undefined,
    chat: async request => { requests.push(request); const next = script[request.model]?.shift(); if (!next) throw new ChatError("UNAVAILABLE", "no scripted answer"); if (next instanceof ChatError) throw next; return next; },
    reserve: async () => `r${++ledger.reserved}`, complete: async () => { ledger.completed++; }, release: async (_id, billed) => { if (billed) ledger.keptReserved++; else ledger.released++; },
    ...overrides
  };
  return { deps, requests, ledger, called: (model: string) => requests.filter(request => request.model === model).length };
}
const run = (deps: ScoringDeps, configured = slots) => runEnsemble(prompt, configured, deps, { candidate, reasoningEffort: "low" });

describe("multi-model scoring", () => {
  it("scores every slot with the identical prompt and averages the valid scores in code", async () => {
    const { deps, requests } = harness({ [SONNET]: [ok(SONNET, 92)], [FABLE]: [ok(FABLE, 88)], [ASTRA]: [ok(ASTRA, 95)] });
    const result = await run(deps);
    expect(result).toMatchObject({ status: "COMPLETE", average: 91.67, scored: 3, planned: 3, stopped: null });
    expect(result.slots.map(slot => [slot.model, slot.score, slot.fallbackUsed])).toEqual([[SONNET, 92, false], [FABLE, 88, false], [ASTRA, 95, false]]);
    expect(new Set(requests.map(request => JSON.stringify(request.messages))).size).toBe(1); // same rubric, profile and job for all
    expect(requests.every(request => request.jsonSchema?.name === "job_match_assessment" && request.reasoningEffort === "low")).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.012, 6);
  });
  it("retries a rate-limited model once, then uses the slot's fallback and records which model answered", async () => {
    const { deps, called } = harness({ [SONNET]: [new ChatError("RATE_LIMIT", "429"), new ChatError("RATE_LIMIT", "429")], [SONNET5]: [ok("anthropic/claude-sonnet-5-20260630", 80)], [FABLE]: [ok(FABLE, 84)], [ASTRA]: [ok(ASTRA, 90)] });
    const result = await run(deps);
    expect(called(SONNET)).toBe(2); expect(result.status).toBe("COMPLETE"); expect(result.average).toBe(84.67);
    const first = result.slots[0]!; expect(first).toMatchObject({ status: "SCORED", primaryModel: SONNET, model: "anthropic/claude-sonnet-5-20260630", fallbackUsed: true, score: 80 });
    expect(first.attempts.map(attempt => [attempt.model, attempt.outcome, attempt.code ?? null, attempt.retry])).toEqual([[SONNET, "FAILED", "RATE_LIMIT", 0], [SONNET, "FAILED", "RATE_LIMIT", 1], [SONNET5, "SCORED", null, 0]]);
  });
  it("moves to the fallback at once on a token or context limit, without a pointless retry", async () => {
    const { deps, called } = harness({ [SONNET]: [ok(SONNET, 70)], [FABLE]: [ok(FABLE, 70)], [ASTRA]: [new ChatError("CONTEXT_LIMIT", "maximum context length")], [LUNA]: [ok(LUNA, 76)] });
    const result = await run(deps);
    expect(called(ASTRA)).toBe(1); expect(result.slots[2]).toMatchObject({ model: LUNA, score: 76, fallbackUsed: true }); expect(result.average).toBe(72);
  });
  it("treats a truncated answer as an output-limit failure and falls back", async () => {
    const { deps } = harness({ [SONNET]: [ok(SONNET, 70)], [FABLE]: [{ ...ok(FABLE, 99), content: "{\"dimensions\":", finishReason: "length" }], [FABLE5]: [ok(FABLE5, 60)], [ASTRA]: [ok(ASTRA, 80)] });
    const result = await run(deps);
    expect(result.slots[1]!.attempts[0]).toMatchObject({ outcome: "FAILED", code: "OUTPUT_LIMIT" }); expect(result.slots[1]).toMatchObject({ model: FABLE5, score: 60 }); expect(result.average).toBe(70);
  });
  it("rejects an out-of-range score instead of averaging it", async () => {
    const { deps, ledger } = harness({ [SONNET]: [ok(SONNET, 70)], [FABLE]: [ok(FABLE, 150)], [FABLE5]: [ok(FABLE5, 64)], [ASTRA]: [ok(ASTRA, 82)] });
    const result = await run(deps);
    expect(result.slots[1]!.attempts[0]).toMatchObject({ outcome: "FAILED", code: "INVALID_RESPONSE" }); expect(result.slots[1]!.score).toBe(64); expect(result.average).toBe(72);
    expect(ledger.completed).toBe(4); // the rejected answer was still billed and is accounted for
  });
  it("averages only the slots that scored and reports reduced coverage", async () => {
    const { deps } = harness({ [SONNET]: [ok(SONNET, 91)], [FABLE]: [ok(FABLE, 92)], [ASTRA]: [new ChatError("UNAVAILABLE", "down")], [LUNA]: [new ChatError("PROVIDER", "502"), new ChatError("PROVIDER", "502")] });
    const result = await run(deps);
    expect(result).toMatchObject({ status: "PARTIAL", scored: 2, planned: 3, average: 91.5 }); expect(result.slots[2]).toMatchObject({ status: "FAILED", score: null });
    expect(result.slots[2]!.error).toContain(LUNA);
  });
  it("marks the scoring failed, with no invented score, when no model answers", async () => {
    const { deps, ledger } = harness({});
    const result = await run(deps);
    expect(result).toMatchObject({ status: "FAILED", average: null, scored: 0 }); expect(ledger.released).toBeGreaterThan(0); expect(ledger.completed).toBe(0);
  });
  it("keeps timed-out calls counted against the budget, because they may have been billed", async () => {
    const { deps, ledger } = harness({ [SONNET]: [new ChatError("TIMEOUT", "slow", true), ok(SONNET, 70)], [FABLE]: [ok(FABLE, 70)], [ASTRA]: [ok(ASTRA, 70)] });
    const result = await run(deps); expect(result.status).toBe("COMPLETE"); expect(ledger.keptReserved).toBe(1); expect(result.slots[0]!.fallbackUsed).toBe(false);
  });
  it("stops every slot when the daily AI budget is reached", async () => {
    const { deps, requests } = harness({ [SONNET]: [ok(SONNET, 70)] }, { reserve: async () => { throw new Error("Daily AI cost limit reached."); } });
    const result = await run(deps);
    expect(requests).toHaveLength(0); expect(result).toMatchObject({ status: "FAILED", average: null, stopped: { code: "BUDGET", message: "Daily AI cost limit reached." } });
  });
  it("stops trying other models when OpenRouter rejects the key", async () => {
    const { deps } = harness({ [SONNET]: [new ChatError("AUTH", "bad key")], [FABLE]: [new ChatError("AUTH", "bad key")], [ASTRA]: [new ChatError("AUTH", "bad key")] });
    const result = await run(deps); expect(result.stopped?.code).toBe("AUTH"); expect(result.status).toBe("FAILED");
    expect(result.slots.flatMap(slot => slot.attempts).filter(attempt => attempt.model === SONNET5 || attempt.model === FABLE5 || attempt.model === LUNA).every(attempt => attempt.outcome === "SKIPPED")).toBe(true);
  });
  it("never lets one model answer for two slots", async () => {
    const shared = [{ slot: 1, models: [SONNET, FABLE] }, { slot: 2, models: [FABLE, ASTRA] }];
    const { deps, called } = harness({ [SONNET]: [new ChatError("UNAVAILABLE", "down")], [FABLE]: [ok(FABLE, 80)] });
    const result = await run(deps, shared);
    expect(called(FABLE)).toBe(1); expect(result.slots[0]!.attempts[1]).toMatchObject({ model: FABLE, outcome: "SKIPPED", code: "DUPLICATE_MODEL" });
    expect(result).toMatchObject({ status: "PARTIAL", scored: 1, average: 80 });
  });
  it("skips a model OpenRouter does not list, and one whose context window is too small, without calling it", async () => {
    const small: ModelCatalog = new Map(catalog); small.delete(SONNET); small.set(FABLE, { ...small.get(FABLE)!, contextLength: 1_000 });
    const { deps, called } = harness({ [SONNET5]: [ok(SONNET5, 70)], [FABLE5]: [ok(FABLE5, 70)], [ASTRA]: [ok(ASTRA, 70)] }, { catalog: small });
    const result = await run(deps);
    expect(called(SONNET) + called(FABLE)).toBe(0); expect(result.slots[0]!.attempts[0]).toMatchObject({ code: "UNAVAILABLE", outcome: "SKIPPED" }); expect(result.slots[1]!.attempts[0]).toMatchObject({ code: "CONTEXT_LIMIT", outcome: "SKIPPED" }); expect(result.status).toBe("COMPLETE");
  });
});

describe("rubric arithmetic", () => {
  const assessment = (scores: Record<string, number>, missing = 0) => ({ dimensions: Object.fromEntries(rubric.map(item => [item.key, { score: scores[item.key] ?? 0, reasoning: "x" }])) as Assessment["dimensions"], requiredQualifications: Array.from({ length: missing }, (_, index) => ({ requirement: `R${index}`, status: "missing" as const, evidence: "" })) });
  it("weights the seven dimensions and rounds once", () => {
    expect(rubric.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    // 90·22 + 70·15 + 80·20 + 60·10 + 100·8 + 50·10 + 75·15 = 7655 → 76.55 → 77
    expect(modelScore(assessment({ skills: 90, experience: 70, requirements: 80, seniority: 60, workStyle: 100, location: 50, overall: 75 }))).toEqual({ score: 77, weighted: 76.55, missingRequired: 0 });
  });
  it("penalises missing mandatory qualifications strongly", () => {
    const all = (value: number) => Object.fromEntries(rubric.map(item => [item.key, value]));
    expect(modelScore(assessment(all(80), 1)).score).toBe(55); expect(modelScore(assessment(all(80), 3)).score).toBe(41); expect(modelScore(assessment(all(40), 1)).score).toBe(40); expect(modelScore(assessment(all(10), 9)).score).toBe(0);
  });
  it("computes a deterministic two-decimal mean", () => {
    expect(averageScore([92, 88, 95])).toBe(91.67); expect(averageScore([91, 92])).toBe(91.5); expect(averageScore([70])).toBe(70); expect(averageScore([])).toBeNull(); expect(averageScore([100, 100, 99])).toBe(99.67);
  });
});

describe("answer validation and the no-invention guard", () => {
  it("accepts fenced or wrapped JSON, rounds fractional scores and rejects incomplete rubrics", () => {
    expect(parseAssessment("```json\n" + answer(80) + "\n```").dimensions.skills.score).toBe(80);
    expect(parseAssessment(`Here is the assessment: ${answer(87.6)} Thanks.`).dimensions.overall.score).toBe(88);
    const missing = JSON.parse(answer(80)) as { dimensions: Record<string, unknown> }; delete missing.dimensions.location;
    expect(() => parseAssessment(JSON.stringify(missing))).toThrow(/location/);
    expect(() => parseAssessment(answer(-5))).toThrow(ChatError); expect(() => parseAssessment("no json at all")).toThrow(/no JSON/);
  });
  it("drops skills the profile does not list and downgrades unsupported 'met' claims", () => {
    const parsed = parseAssessment(answer(80, {
      matchedSkills: ["SSIS", "Kubernetes", "sql server"],
      requiredQualifications: [{ requirement: "SSIS", status: "met", evidence: "coreSkills: SSIS" }, { requirement: "CKA certification", status: "met", evidence: "Holds the CKA certification" }, { requirement: "3 years", status: "met", evidence: "5 years of experience as Data Engineer" }, { requirement: "German", status: "missing", evidence: "" }]
    }));
    const checked = checkAgainstProfile(parsed, candidate);
    expect(checked.matchedSkills).toEqual(["SSIS", "sql server"]);
    expect(checked.requiredQualifications.map(item => [item.status, item.verified])).toEqual([["met", true], ["unclear", false], ["met", true], ["missing", false]]);
  });
});

describe("scoring input identity", () => {
  const base = job({ descriptionClean: strongDescription, sourceJobId: "same", sourceUrl: "https://jobs.example.test/same" });
  it("hashes identical inputs identically and changes the hash when what the models see changes", () => {
    const preferences = scoringPreferences([searchProfile]);
    expect(scoringPrompt(candidate, preferences, base).inputHash).toBe(scoringPrompt(candidate, preferences, { ...base }).inputHash);
    expect(scoringPrompt(candidate, preferences, { ...base, descriptionClean: `${strongDescription} Kubernetes.` }).inputHash).not.toBe(scoringPrompt(candidate, preferences, base).inputHash);
    expect(scoringPrompt({ ...candidate, yearsExperience: 6 }, preferences, base).inputHash).not.toBe(scoringPrompt(candidate, preferences, base).inputHash);
  });
  it("ignores profile settings the models never see, but not work styles", () => {
    const hash = (overrides: Record<string, unknown>) => scoringPrompt(candidate, scoringPreferences([searchProfileInputSchema.parse({ ...searchProfile, ...overrides })]), base).inputHash;
    expect(hash({ name: "Renamed", providers: ["lever"], minimumMatchScore: 70 })).toBe(hash({}));
    expect(hash({ remotePreferences: ["remote"] })).not.toBe(hash({}));
    expect(hash({ locations: ["Nancy", "Metz"] })).toBe(hash({ locations: ["Metz", "Nancy"] })); // order does not matter
  });
  it("puts the untrusted job text in a delimited block and truncates very long descriptions", () => {
    const long = scoringPrompt(candidate, scoringPreferences([searchProfile]), { ...base, descriptionClean: "x".repeat(60_000) });
    expect(long.user).toContain("[truncated]"); expect(long.user.length).toBeLessThan(40_000); expect(long.user).toMatch(/<UNTRUSTED_JOB_JSON>.*<\/UNTRUSTED_JOB_JSON>$/s);
  });
});

describe("OpenRouter client", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENROUTER_API_KEY; resetCatalogCache(); });
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => { const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers })); vi.stubGlobal("fetch", fetch); return fetch; };
  const request: ChatRequest = { model: SONNET, messages: [{ role: "user", content: "hi" }], maxTokens: 100, jsonSchema: { name: "x", schema: { type: "object" } }, reasoningEffort: "low" };
  const fresh = async () => { vi.resetModules(); process.env.OPENROUTER_API_KEY = "sk-or-test"; return (await import("@/ai/openrouter")).openRouterChat; };

  it("sends the schema and reasoning settings, never a temperature, and reads usage and the actual model", async () => {
    const chat = await fresh(); const fetch = respond(200, { model: "anthropic/claude-sonnet-5.5-20260928", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.00011 } });
    const result = await chat(request);
    expect(result).toEqual({ content: "{}", model: "anthropic/claude-sonnet-5.5-20260928", inputTokens: 12, outputTokens: 3, costUsd: 0.00011, finishReason: "stop" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions"); expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    expect(body).toMatchObject({ model: SONNET, max_tokens: 100, response_format: { type: "json_schema", json_schema: { name: "x", strict: true } }, reasoning: { effort: "low" } }); expect(body).not.toHaveProperty("temperature"); expect(String(init.body)).not.toContain("sk-or-test");
  });
  it.each([
    [429, { error: { message: "Rate limit exceeded" } }, "RATE_LIMIT"], [400, { error: { message: "This model's maximum context length is 1000000 tokens" } }, "CONTEXT_LIMIT"], [402, { error: { message: "Insufficient credits" } }, "QUOTA"],
    [401, { error: { message: "No auth credentials found" } }, "AUTH"], [404, { error: { message: "No endpoints found" } }, "UNAVAILABLE"], [503, { error: { message: "No available providers" } }, "UNAVAILABLE"], [502, { error: { message: "Bad gateway" } }, "PROVIDER"], [400, { error: { message: "Invalid parameter" } }, "BAD_REQUEST"]
  ])("classifies HTTP %i as %s", async (status, body, code) => {
    const chat = await fresh(); respond(status, body, status === 429 ? { "retry-after": "3" } : {});
    const error = await chat(request).catch((reason: unknown) => reason) as ChatError;
    expect(error.code).toBe(code); expect(error.billed).toBe(false); if (status === 429) expect(error.retryAfterMs).toBe(3_000);
  });
  it("treats an error reported inside a 200 response as a billed provider failure", async () => {
    const chat = await fresh(); respond(200, { error: { code: 502, message: "upstream failed" } });
    await expect(chat(request)).rejects.toMatchObject({ code: "PROVIDER", billed: true });
  });
  it("reads OpenRouter's catalog: availability, limits, parameters and per-million prices", async () => {
    respond(200, { data: [{ id: SONNET, context_length: 1_000_000, pricing: { prompt: "0.000002", completion: "0.00001" }, top_provider: { max_completion_tokens: 128_000 }, supported_parameters: ["reasoning", "response_format"] }, { id: "broken/model", pricing: {} }] });
    const result = await modelCatalog();
    expect(result?.get(SONNET)).toMatchObject({ contextLength: 1_000_000, maxCompletionTokens: 128_000, inputPerMillion: 2, outputPerMillion: 10 }); expect(result?.get(SONNET)?.parameters.has("reasoning")).toBe(true); expect(result?.has("broken/model")).toBe(false);
  });
  it("refuses to call without a key", async () => { vi.resetModules(); delete process.env.OPENROUTER_API_KEY; const { openRouterChat: chat } = await import("@/ai/openrouter"); await expect(chat(request)).rejects.toMatchObject({ code: "AUTH" }); });
});
