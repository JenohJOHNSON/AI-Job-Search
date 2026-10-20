import { Prisma } from "@prisma/client";
import { modelCatalog, openRouterChat } from "@/ai/openrouter";
import { RUBRIC_VERSION, runEnsemble, scoringPreferences, scoringPrompt, type SlotOutcome } from "@/ai/scoring";
import { config, scoringSlots } from "@/lib/config";
import { db } from "@/lib/db";
import type { NormalizedJob } from "@/lib/schemas";
import { saveMatch } from "@/lib/services/jobs";
import type { MatchingContext } from "@/lib/services/matching";
import { completeAiCall, releaseAiCall, reserveAiCall } from "@/lib/services/usage";
import type { MatchResult } from "@/matching/score";

// A scoring still marked RUNNING after this long belongs to a worker that stopped; it may be redone.
const STALE_RUNNING_MS = 10 * 60_000;
export type ScoringOutcome = { status: "SKIPPED" | "COMPLETE" | "PARTIAL" | "FAILED"; average: number | null; scored: number; planned: number; stopped: { code: string; message: string } | null; error: string | null };
const decimal = (value: number) => new Prisma.Decimal(value.toFixed(6));
const slotData = (outcome: SlotOutcome) => ({
  status: outcome.status, model: outcome.model, score: outcome.score, result: outcome.assessment ? { assessment: outcome.assessment, computed: outcome.computed } as Prisma.InputJsonValue : Prisma.JsonNull,
  attempts: outcome.attempts as unknown as Prisma.InputJsonValue, fallbackUsed: outcome.fallbackUsed, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens, costUsd: decimal(outcome.costUsd), latencyMs: outcome.latencyMs, error: outcome.error?.slice(0, 1_000) ?? null
});

/** Whether a scoring of this exact input is running now (so a second one would duplicate cost). */
export async function scoringInProgress(jobId: string) {
  return Boolean(await db.jobScoring.findFirst({ where: { jobId, status: "RUNNING", createdAt: { gte: new Date(Date.now() - STALE_RUNNING_MS) } }, select: { id: true } }));
}

/**
 * Scores one job with every configured model and stores each model's result, the actual models used and the average.
 * Unchanged inputs already scored (completely or partially) are skipped unless `force` is set; a failed scoring leaves the
 * job's previous score untouched rather than inventing one.
 */
export async function scoreWithModels(jobId: string, normalized: NormalizedJob, rules: MatchResult, context: MatchingContext, options: { force?: boolean } = {}): Promise<ScoringOutcome> {
  const { slots } = scoringSlots(); const prompt = scoringPrompt(context.candidate, scoringPreferences(context.profiles), normalized);
  const skipped: ScoringOutcome = { status: "SKIPPED", average: null, scored: 0, planned: slots.length, stopped: null, error: null };
  const existing = await db.jobScoring.findUnique({ where: { jobId_inputHash: { jobId, inputHash: prompt.inputHash } } });
  if (existing?.status === "RUNNING" && Date.now() - existing.createdAt.getTime() < STALE_RUNNING_MS) return skipped;
  if (existing && !options.force && (existing.status === "COMPLETE" || existing.status === "PARTIAL")) return { ...skipped, average: existing.averageScore === null ? null : Number(existing.averageScore), scored: existing.slotsScored };
  let scoringId: string;
  try {
    scoringId = await db.$transaction(async transaction => {
      if (existing) await transaction.jobScoring.delete({ where: { id: existing.id } });
      const created = await transaction.jobScoring.create({ data: { jobId, inputHash: prompt.inputHash, rubricVersion: RUBRIC_VERSION, status: "RUNNING", slotsPlanned: slots.length, scores: { create: slots.map(slot => ({ slot: slot.slot, primaryModel: slot.models[0]!, status: "PENDING" })) } } });
      return created.id;
    });
  } catch (error) {
    // Another worker started the same scoring a moment earlier.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2025")) return skipped;
    throw error;
  }
  try {
    const effort = config().AI_SCORING_REASONING_EFFORT;
    const result = await runEnsemble(prompt, slots, {
      catalog: await modelCatalog(), chat: request => openRouterChat(request),
      reserve: (model, inputTokens, maxOutputTokens, pricing) => reserveAiCall({ provider: "openrouter", model, operation: "JOB_SCORING", inputTokens, maxOutputTokens, pricing }),
      complete: completeAiCall, release: releaseAiCall,
      onSlot: async outcome => { await db.jobModelScore.update({ where: { scoringId_slot: { scoringId, slot: outcome.slot } }, data: slotData(outcome) }); }
    }, { candidate: context.candidate, reasoningEffort: effort === "default" ? undefined : effort, context: jobId });
    const error = result.stopped?.message ?? (result.status === "FAILED" ? result.slots.map(slot => `Slot ${slot.slot}: ${slot.error ?? "no valid score"}`).join(" · ") : null);
    await db.jobScoring.update({ where: { id: scoringId }, data: { status: result.status, averageScore: result.average === null ? null : new Prisma.Decimal(result.average.toFixed(2)), slotsScored: result.scored, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: decimal(result.costUsd), error: error?.slice(0, 2_000) ?? null, completedAt: new Date() } });
    if (result.average !== null) {
      const rounded = Math.round(result.average);
      await db.job.update({ where: { id: jobId }, data: { matchScore: rounded, aiAverageScore: new Prisma.Decimal(result.average.toFixed(2)) } });
      await saveMatch(jobId, rules, context.profileVersion, rounded);
    }
    return { status: result.status, average: result.average, scored: result.scored, planned: result.planned, stopped: result.stopped, error };
  } catch (error) {
    await db.jobScoring.update({ where: { id: scoringId }, data: { status: "FAILED", error: `Scoring stopped unexpectedly: ${(error as Error).message}`.slice(0, 2_000), completedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}
