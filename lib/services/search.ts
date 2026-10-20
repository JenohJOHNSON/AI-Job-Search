import { ErrorCode, Prisma, RunTrigger, type ProviderStatus } from "@prisma/client";
import { evaluateJob } from "@/ai";
import { aiConfigured, config } from "@/lib/config";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import type { NormalizedJob } from "@/lib/schemas";
import { expireByDate, reconcileCoverage, verifyStale } from "@/lib/services/lifecycle";
import { ingestJob, saveMatch } from "@/lib/services/jobs";
import { loadMatchingContext } from "@/lib/services/matching";
import { loadSettings } from "@/lib/services/settings";
import { usageHooks } from "@/lib/services/usage";
import { expandTitles } from "@/matching/queries";
import { scoreJob, type MatchResult } from "@/matching/score";
import { createProvider, type ProviderConfig, type ProviderError } from "@/providers";

// Scheduled and GitHub-triggered runs are skipped when a run finished very recently; manual runs always proceed.
const MIN_AUTOMATED_INTERVAL_MS = 3 * 3_600_000;
type RunError = { provider: string; code: string; message: string };

const findActive = () => db.searchRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" } });

export async function createSearchRun(trigger: RunTrigger, idempotencyKey?: string) {
  if (idempotencyKey) { const same = await db.searchRun.findUnique({ where: { idempotencyKey } }); if (same) return same; }
  const active = await findActive(); if (active) return active;
  if (trigger !== "MANUAL") {
    const recent = await db.searchRun.findFirst({ where: { status: "FINISHED", createdAt: { gte: new Date(Date.now() - MIN_AUTOMATED_INTERVAL_MS) } }, orderBy: { createdAt: "desc" } });
    if (recent) return recent;
  }
  try {
    // The run and its task are created together so a crash can never leave a run that nothing will execute.
    return await db.$transaction(async tx => {
      const run = await tx.searchRun.create({ data: { trigger, idempotencyKey, status: "QUEUED" } });
      await tx.task.create({ data: { type: "SEARCH_RUN", payload: { runId: run.id }, idempotencyKey: `search-run:${run.id}`, searchRunId: run.id } });
      return run;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const existing = await findActive() ?? (idempotencyKey ? await db.searchRun.findUnique({ where: { idempotencyKey } }) : null); if (existing) return existing; }
    throw error;
  }
}

const knownCodes = new Set<ErrorCode>(["RATE_LIMIT", "TIMEOUT", "PARSER_CHANGED", "BLOCKED", "AUTH", "NOT_FOUND", "NETWORK"]);
const errorCode = (error: unknown): ErrorCode => { const code = (error as ProviderError)?.code; return knownCodes.has(code as ErrorCode) ? code as ErrorCode : "UNKNOWN"; };
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
function providerConfig(value: Prisma.JsonValue, rateLimitMs: number, strategies: Prisma.JsonValue): ProviderConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { boards: strings(object.boards), urls: strings(object.urls), allowedHosts: strings(object.allowedHosts), rateLimitMs, strategies: strings(strategies) };
}

async function recordProvider(runId: string, providerId: string, outcome: { status: ProviderStatus; discovered?: number; valid?: number; invalid?: number; durationMs: number; code?: ErrorCode; message?: string; stats?: Prisma.InputJsonValue }) {
  const message = outcome.message?.slice(0, 2_000) || null; const ok = outcome.status === "HEALTHY" || outcome.status === "DEGRADED";
  await db.providerRun.create({ data: { runId, providerId, status: outcome.status, jobsDiscovered: outcome.discovered ?? 0, jobsValid: outcome.valid ?? 0, jobsInvalid: outcome.invalid ?? 0, durationMs: outcome.durationMs, errorCode: outcome.code, errorMessage: message, extractorStats: outcome.stats ?? {} } });
  await db.providerHealth.upsert({
    where: { providerId },
    create: { providerId, status: outcome.status, message, lastSuccessAt: ok ? new Date() : null, jobsDiscovered: outcome.discovered ?? 0, attemptCount: 1, errorCount: ok ? 0 : 1, extractionStats: outcome.stats ?? {} },
    update: { status: outcome.status, message, ...(ok ? { lastSuccessAt: new Date(), jobsDiscovered: { increment: outcome.discovered ?? 0 } } : {}), attemptCount: { increment: 1 }, ...(ok ? {} : { errorCount: { increment: 1 } }), ...(outcome.stats ? { extractionStats: outcome.stats } : {}) }
  });
}

async function finish(runId: string, status: "FINISHED" | "FAILED", totals: Record<string, number>, errors: RunError[]) {
  await db.searchRun.update({ where: { id: runId }, data: { ...totals, errors, status, completedAt: new Date() } });
  return status;
}

/**
 * Executes one search run: query every enabled provider (failures are isolated), score and store relevant vacancies,
 * reconcile removed ones, then spend the bounded AI budget on the best candidates. Safe to call again after a crash.
 * `finalAttempt` lets the queue retry unexpected errors before the run is declared failed.
 */
export async function processSearchRun(runId: string, finalAttempt = true): Promise<"FINISHED" | "FAILED" | "SKIPPED"> {
  const existing = await db.searchRun.findUnique({ where: { id: runId } });
  if (!existing || existing.status === "FINISHED" || existing.status === "FAILED") return "SKIPPED";
  await db.providerRun.deleteMany({ where: { runId } });
  await db.searchRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date(), completedAt: null } });
  const totals = { providersAttempted: 0, providersSuccessful: 0, providersFailed: 0, jobsDiscovered: 0, jobsNew: 0, jobsDuplicate: 0, jobsAnalyzed: 0, jobsHighMatch: 0 };
  const errors: RunError[] = [];
  try {
    const context = await loadMatchingContext();
    if (!context) { errors.push({ provider: "-", code: "UNKNOWN", message: "Complete and save your candidate profile before running a search." }); return finish(runId, "FAILED", totals, errors); }
    const profiles = await db.searchProfile.findMany({ where: { userId: context.userId, enabled: true } });
    if (!profiles.length) { errors.push({ provider: "-", code: "UNKNOWN", message: "Create and enable at least one search profile." }); return finish(runId, "FAILED", totals, errors); }
    const { candidate, profiles: parsed, profileVersion } = context; const settings = await loadSettings(); const env = config();
    const titles = parsed.flatMap(profile => [...profile.targetTitles, ...profile.alternativeTitles]); const queries = expandTitles(titles.length ? titles : [...candidate.targetRoles, ...candidate.secondaryRoles]);
    const requested = new Set(parsed.flatMap(profile => profile.providers));
    const providers = await db.providerSetting.findMany({ where: { enabled: true, supported: true, ...(requested.size ? { id: { in: [...requested] } } : {}) } });
    if (!providers.length) { errors.push({ provider: "-", code: "UNKNOWN", message: "No job source is enabled. Enable and configure at least one source under Job sources." }); return finish(runId, "FAILED", totals, errors); }
    const floor = Math.min(...parsed.map(profile => profile.minimumMatchScore));
    const request = {
      queries, locations: [...new Set([...parsed.flatMap(profile => profile.locations), ...candidate.locations])], remotePreferences: [...new Set(parsed.flatMap(profile => profile.remotePreferences))],
      datePostedWindow: Math.max(...parsed.map(profile => profile.datePostedWindow)), contractTypes: [...new Set([...parsed.flatMap(profile => profile.contractTypes), ...candidate.contractTypes])]
    };
    const stored = new Map<string, { match: MatchResult; normalized: NormalizedJob; fingerprint: string }>(); let storedCount = 0;

    for (const setting of providers) {
      if (storedCount >= settings.limits.maxTotalJobsPerRun) break;
      totals.providersAttempted++; const started = Date.now(); const seenAt = new Date();
      try {
        const adapter = createProvider(setting.id, providerConfig(setting.config, setting.rateLimitMs, setting.strategies));
        const cap = Math.max(0, Math.min(setting.maxJobs, settings.limits.maxJobsPerProvider, settings.limits.maxTotalJobsPerRun - storedCount));
        // Free sources over-fetch so scoring can pick the best; pay-per-result sources fetch exactly their own limit.
        const result = await adapter.search({ ...request, maxJobs: Math.min(1_150, Math.max(cap, 1) * 4), paidItems: Math.max(cap, 1) });
        const scored = result.jobs.map(job => ({ job, match: scoreJob(candidate, job, parsed) })).filter(item => item.match.score >= floor).sort((a, b) => b.match.score - a.match.score);
        let added = 0, duplicates = 0;
        for (const item of scored.slice(0, cap)) {
          const saved = await ingestJob(item.job, seenAt); await saveMatch(saved.job.id, item.match, profileVersion);
          if (saved.duplicate) duplicates++; else added++;
          stored.set(saved.job.id, { match: item.match, normalized: item.job, fingerprint: saved.job.contentFingerprint });
        }
        storedCount += added + duplicates; totals.jobsDiscovered += result.jobs.length; totals.jobsNew += added; totals.jobsDuplicate += duplicates;
        const warnings = [...result.warnings];
        const lifecycle = result.coverage ? await reconcileCoverage(setting.id, result.coverage, seenAt) : { removed: 0, reactivated: 0, warnings: [] as string[] };
        warnings.push(...lifecycle.warnings);
        const verified = adapter.verify ? await verifyStale(adapter).catch(error => { warnings.push(`Could not verify older offers: ${(error as Error).message}`); return { checked: 0, removed: 0 }; }) : { checked: 0, removed: 0 };
        if (result.stats.fetched === 0 && !warnings.length) warnings.push("The source returned no vacancies for this search.");
        const degraded = warnings.length > 0 || (result.stats.fetched > 0 && result.stats.invalid / result.stats.fetched > 0.5);
        totals.providersSuccessful++;
        await recordProvider(runId, setting.id, { status: degraded ? "DEGRADED" : "HEALTHY", discovered: result.jobs.length, valid: result.stats.valid, invalid: result.stats.invalid, durationMs: Date.now() - started, message: warnings.join("; "), stats: { ...result.stats, relevant: scored.length, stored: added + duplicates, newJobs: added, removed: lifecycle.removed + verified.removed, reactivated: lifecycle.reactivated, verified: verified.checked } });
        log("info", "provider_search", { stage: setting.id, status: degraded ? "DEGRADED" : "HEALTHY", duration: Date.now() - started, fetched: result.stats.fetched, relevant: scored.length, stored: added + duplicates, removed: lifecycle.removed + verified.removed });
      } catch (error) {
        totals.providersFailed++; const code = errorCode(error); const message = (error as Error).message;
        errors.push({ provider: setting.id, code, message: message.slice(0, 500) });
        await recordProvider(runId, setting.id, { status: "FAILED", durationMs: Date.now() - started, code, message });
        log("warn", "provider_failed", { stage: setting.id, status: "FAILED", code, duration: Date.now() - started });
      }
    }
    await expireByDate();

    if (aiConfigured() && stored.size) {
      // Postings known only from a job-alert email carry no description, so an AI analysis would add cost but no insight.
      const queue = [...stored.entries()].filter(([, item]) => !item.match.blockers.length && item.match.score >= settings.ai.matchThreshold && !item.normalized.extractor.startsWith("email_alert")).sort((a, b) => b[1].match.score - a[1].match.score);
      for (const [jobId, item] of queue) {
        const prior = await db.jobAnalysis.findUnique({ where: { jobId_profileVersion_contentFingerprint: { jobId, profileVersion, contentFingerprint: item.fingerprint } } }); if (prior) continue;
        try {
          const analyzed = await evaluateJob(candidate, item.normalized, usageHooks, item.match);
          const cost = analyzed.usage.inputTokens * (env.AI_INPUT_PRICE_PER_MILLION ?? 0) / 1_000_000 + analyzed.usage.outputTokens * (env.AI_OUTPUT_PRICE_PER_MILLION ?? 0) / 1_000_000;
          await db.jobAnalysis.create({ data: { jobId, profileVersion, contentFingerprint: item.fingerprint, result: analyzed.result, score: analyzed.result.overallMatchScore, recommendation: analyzed.result.applicationRecommendation, confidence: analyzed.result.confidence, model: analyzed.usage.model, provider: env.AI_PROVIDER, inputTokens: analyzed.usage.inputTokens, outputTokens: analyzed.usage.outputTokens, estimatedCost: new Prisma.Decimal(cost) } });
          await db.job.update({ where: { id: jobId }, data: { matchScore: analyzed.result.overallMatchScore } }); await saveMatch(jobId, item.match, profileVersion, analyzed.result.overallMatchScore); totals.jobsAnalyzed++;
        } catch (analysisError) {
          const message = (analysisError as Error).message; errors.push({ provider: "ai", code: "AI_PROVIDER", message: message.slice(0, 500) });
          if (/daily ai|disabled/i.test(message)) break; // budget exhausted or AI switched off: stop spending, keep the rule-based results
        }
      }
    }
    totals.jobsHighMatch = stored.size ? await db.job.count({ where: { id: { in: [...stored.keys()] }, rankScore: { gte: settings.notifications.minScore } } }) : 0;
    return finish(runId, totals.providersSuccessful > 0 ? "FINISHED" : "FAILED", totals, errors);
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    if (finalAttempt) { errors.push({ provider: "-", code: "UNKNOWN", message }); await finish(runId, "FAILED", totals, errors); return "FAILED"; }
    await db.searchRun.update({ where: { id: runId }, data: { errors: [...errors, { provider: "-", code: "UNKNOWN", message: `Retrying after: ${message}` }] } });
    throw error;
  }
}
