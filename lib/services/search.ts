import { ErrorCode, Prisma, RunTrigger } from "@prisma/client";
import { evaluateJob } from "@/ai";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { candidateProfileSchema, searchProfileInputSchema } from "@/lib/schemas";
import { ingestJob } from "@/lib/services/jobs";
import { enqueueTask } from "@/lib/services/queue";
import { usageHooks } from "@/lib/services/usage";
import { prefilterJob } from "@/matching/prefilter";
import { createProvider, type ProviderConfig, type ProviderError } from "@/providers";

export async function createSearchRun(trigger: RunTrigger, idempotencyKey?: string) {
  const existing = await db.searchRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" } });
  if (existing) return existing;
  try {
    const run = await db.searchRun.create({ data: { trigger, idempotencyKey, status: "QUEUED" } });
    await enqueueTask("SEARCH_RUN", { runId: run.id }, `search-run:${run.id}`, run.id); return run;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const active = await db.searchRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" } }); if (active) return active; }
    throw error;
  }
}

function errorCode(error: unknown): ErrorCode {
  const code = (error as ProviderError)?.code;
  const known = new Set<ErrorCode>(["RATE_LIMIT", "TIMEOUT", "PARSER_CHANGED", "BLOCKED", "AUTH", "NETWORK"]);
  return known.has(code as ErrorCode) ? code as ErrorCode : "UNKNOWN";
}
function providerConfig(value: Prisma.JsonValue, rateLimitMs: number, strategies: Prisma.JsonValue): ProviderConfig { const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; return { boards: Array.isArray(object.boards) ? object.boards.filter((v): v is string => typeof v === "string") : [], urls: Array.isArray(object.urls) ? object.urls.filter((v): v is string => typeof v === "string") : [], allowedHosts: Array.isArray(object.allowedHosts) ? object.allowedHosts.filter((v): v is string => typeof v === "string") : [], rateLimitMs, strategies: Array.isArray(strategies) ? strategies.filter((v): v is string => typeof v === "string") : [] }; }

async function searchQueries(profiles: { id: string; data: Prisma.JsonValue }[]) {
  const parsed = profiles.map(profile => ({ id: profile.id, data: searchProfileInputSchema.parse(profile.data) })); const output: string[] = [];
  for (const profile of parsed) { const queries = [...new Set([...profile.data.targetTitles, ...profile.data.alternativeTitles].map(value => value.trim()).filter(Boolean))].slice(0, 20); for (const query of queries) { const fingerprint = (await import("@/lib/deduplication")).hash(query.toLowerCase()); await db.searchQuery.upsert({ where: { searchProfileId_fingerprint: { searchProfileId: profile.id, fingerprint } }, create: { searchProfileId: profile.id, query, fingerprint, lastUsedAt: new Date() }, update: { query, lastUsedAt: new Date() } }); output.push(query); } }
  return { queries: [...new Set(output)].slice(0, 30), parsed: parsed.map(item => item.data) };
}

export async function processSearchRun(runId: string) {
  const run = await db.searchRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });
  try {
    const user = await db.user.findFirst({ include: { profile: true, searchProfiles: { where: { enabled: true } } } });
    if (!user?.profile) throw new Error("Complete the candidate profile before running a search.");
    if (!user.searchProfiles.length) throw new Error("Create and enable at least one search profile.");
    const candidate = candidateProfileSchema.parse(user.profile.data); const { queries, parsed } = await searchQueries(user.searchProfiles);
    const requestedProviders = new Set(parsed.flatMap(profile => profile.providers));
    const enabledProviders = await db.providerSetting.findMany({
      where: {
        enabled: true,
        supported: true,
        ...(requestedProviders.size ? { id: { in: [...requestedProviders] } } : {}),
      },
    });
    const totals = { providersAttempted: 0, providersSuccessful: 0, providersFailed: 0, jobsDiscovered: 0, jobsNew: 0, jobsDuplicate: 0, jobsAnalyzed: 0, jobsHighMatch: 0 }; const errors: { provider: string; code: string; message: string }[] = [];
    const env = config(); let totalJobs = 0;
    for (const setting of enabledProviders) {
      if (totalJobs >= env.MAX_TOTAL_JOBS_PER_RUN) break; totals.providersAttempted++; const started = Date.now(); const adapter = createProvider(setting.id, providerConfig(setting.config, setting.rateLimitMs, setting.strategies));
      try {
        const request = { queries, locations: [...new Set(parsed.flatMap(profile => profile.locations))], remotePreferences: [...new Set(parsed.flatMap(profile => profile.remotePreferences))], datePostedWindow: Math.min(...parsed.map(profile => profile.datePostedWindow)), maxJobs: Math.min(setting.maxJobs, env.MAX_JOBS_PER_PROVIDER, env.MAX_TOTAL_JOBS_PER_RUN - totalJobs) };
        const result = await adapter.search(request); totals.jobsDiscovered += result.jobs.length; totalJobs += result.jobs.length;
        for (const normalized of result.jobs) {
          const saved = await ingestJob(normalized); if (saved.duplicate) totals.jobsDuplicate++; else totals.jobsNew++;
          const preliminary = prefilterJob(candidate, normalized, parsed); await db.job.update({ where: { id: saved.job.id }, data: { preliminaryScore: preliminary.score } });
          if (preliminary.score >= env.AI_MATCH_THRESHOLD) {
            const prior = await db.jobAnalysis.findUnique({ where: { jobId_profileVersion_contentFingerprint: { jobId: saved.job.id, profileVersion: user.profile.version, contentFingerprint: saved.job.contentFingerprint } } });
            if (!prior) try { const analyzed = await evaluateJob(candidate, normalized, usageHooks); const cost = analyzed.usage.inputTokens * (env.AI_INPUT_PRICE_PER_MILLION ?? 0) / 1_000_000 + analyzed.usage.outputTokens * (env.AI_OUTPUT_PRICE_PER_MILLION ?? 0) / 1_000_000; await db.jobAnalysis.create({ data: { jobId: saved.job.id, profileVersion: user.profile.version, contentFingerprint: saved.job.contentFingerprint, result: analyzed.result, score: analyzed.result.overallMatchScore, recommendation: analyzed.result.applicationRecommendation, confidence: analyzed.result.confidence, model: analyzed.usage.model, provider: env.AI_PROVIDER, inputTokens: analyzed.usage.inputTokens, outputTokens: analyzed.usage.outputTokens, estimatedCost: new Prisma.Decimal(cost) } }); await db.job.update({ where: { id: saved.job.id }, data: { matchScore: analyzed.result.overallMatchScore } }); totals.jobsAnalyzed++; if (analyzed.result.overallMatchScore >= env.NOTIFICATION_SCORE_THRESHOLD) totals.jobsHighMatch++; } catch (analysisError) { errors.push({ provider: setting.id, code: "AI_PROVIDER", message: (analysisError as Error).message.slice(0, 500) }); }
          }
        }
        const degraded = result.stats.fetched > 0 && result.stats.invalid / result.stats.fetched > 0.5; totals.providersSuccessful++; await db.providerRun.create({ data: { runId, providerId: setting.id, status: degraded || result.warnings.length ? "DEGRADED" : "HEALTHY", jobsDiscovered: result.jobs.length, jobsValid: result.stats.valid, jobsInvalid: result.stats.invalid, durationMs: Date.now() - started, extractorStats: result.stats, errorMessage: result.warnings.join("; ").slice(0, 2_000) || null } }); await db.providerHealth.upsert({ where: { providerId: setting.id }, create: { providerId: setting.id, status: degraded || result.warnings.length ? "DEGRADED" : "HEALTHY", message: result.warnings.join("; ").slice(0, 2_000) || null, lastSuccessAt: new Date(), jobsDiscovered: result.jobs.length, attemptCount: 1, extractionStats: result.stats }, update: { status: degraded || result.warnings.length ? "DEGRADED" : "HEALTHY", message: result.warnings.join("; ").slice(0, 2_000) || null, lastSuccessAt: new Date(), jobsDiscovered: { increment: result.jobs.length }, attemptCount: { increment: 1 }, extractionStats: result.stats } });
      } catch (error) {
        totals.providersFailed++; const code = errorCode(error); errors.push({ provider: setting.id, code, message: (error as Error).message.slice(0, 500) }); await db.providerRun.create({ data: { runId, providerId: setting.id, status: "FAILED", durationMs: Date.now() - started, errorCode: code, errorMessage: (error as Error).message.slice(0, 2_000) } }); await db.providerHealth.upsert({ where: { providerId: setting.id }, create: { providerId: setting.id, status: "FAILED", message: (error as Error).message.slice(0, 2_000), errorCount: 1, attemptCount: 1 }, update: { status: "FAILED", message: (error as Error).message.slice(0, 2_000), errorCount: { increment: 1 }, attemptCount: { increment: 1 } } });
      }
    }
    await db.searchRun.update({ where: { id: run.id }, data: { ...totals, errors, status: "FINISHED", completedAt: new Date() } });
  } catch (error) { await db.searchRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), errors: [{ code: "UNKNOWN", message: (error as Error).message.slice(0, 500) }] } }); throw error; }
}
