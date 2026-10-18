import { Prisma } from "@prisma/client";
import { z } from "zod";
import { evaluateJob, extractProfile, generateDocument } from "@/ai";
import { aiConfigured, config } from "@/lib/config";
import { db } from "@/lib/db";
import { candidateProfileSchema } from "@/lib/schemas";
import { normalizedFromStored, saveMatch } from "@/lib/services/jobs";
import { loadMatchingContext, rescoreJobs } from "@/lib/services/matching";
import { sendDigest } from "@/lib/services/notifications";
import { enqueueTask } from "@/lib/services/queue";
import { processSearchRun } from "@/lib/services/search";
import { usageHooks } from "@/lib/services/usage";
import { scoreJob } from "@/matching/score";

const idPayload = z.object({ id: z.string().min(1) });
const cost = (inputTokens: number, outputTokens: number) => { const env = config(); return new Prisma.Decimal(inputTokens * (env.AI_INPUT_PRICE_PER_MILLION ?? 0) / 1_000_000 + outputTokens * (env.AI_OUTPUT_PRICE_PER_MILLION ?? 0) / 1_000_000); };

export async function processTask(type: string, payload: Prisma.JsonValue, meta: { final: boolean } = { final: true }) {
  if (type === "SEARCH_RUN") {
    const { runId } = z.object({ runId: z.string() }).parse(payload);
    const status = await processSearchRun(runId, meta.final);
    if (status === "FINISHED") await enqueueTask("SEND_DIGEST", { runId }, `digest:${runId}`);
    return;
  }
  if (type === "SEND_DIGEST") { await sendDigest(); return; }
  if (type === "RESCORE_JOBS") { await rescoreJobs(); return; }
  if (type === "EXTRACT_RESUME") {
    const { id } = idPayload.parse(payload); const resume = await db.resume.findUniqueOrThrow({ where: { id } });
    if (!aiConfigured()) { await db.resume.update({ where: { id }, data: { extractionStatus: "AI_NOT_CONFIGURED" } }); return; }
    try { const extracted = await extractProfile(resume.sourceText, usageHooks); await db.resume.update({ where: { id }, data: { suggestions: extracted.suggestions, extractionStatus: "PENDING_REVIEW" } }); }
    catch (error) { if (meta.final) await db.resume.update({ where: { id }, data: { extractionStatus: "EXTRACTION_FAILED" } }); throw error; }
    return;
  }
  if (type === "ANALYZE_JOB") {
    const { id } = idPayload.parse(payload);
    const [job, context] = await Promise.all([db.job.findUniqueOrThrow({ where: { id }, include: { sources: true } }), loadMatchingContext()]);
    if (!context) throw new Error("Candidate profile is required.");
    const normalized = normalizedFromStored(job); const rules = scoreJob(context.candidate, normalized, context.profiles);
    const analyzed = await evaluateJob(context.candidate, normalized, usageHooks, rules); const env = config();
    const data = { result: analyzed.result, score: analyzed.result.overallMatchScore, recommendation: analyzed.result.applicationRecommendation, confidence: analyzed.result.confidence, model: analyzed.usage.model, provider: env.AI_PROVIDER, inputTokens: analyzed.usage.inputTokens, outputTokens: analyzed.usage.outputTokens, estimatedCost: cost(analyzed.usage.inputTokens, analyzed.usage.outputTokens) };
    await db.jobAnalysis.upsert({ where: { jobId_profileVersion_contentFingerprint: { jobId: id, profileVersion: context.profileVersion, contentFingerprint: job.contentFingerprint } }, create: { jobId: id, profileVersion: context.profileVersion, contentFingerprint: job.contentFingerprint, ...data }, update: { ...data, createdAt: new Date() } });
    await db.job.update({ where: { id }, data: { matchScore: analyzed.result.overallMatchScore } }); await saveMatch(id, rules, context.profileVersion, analyzed.result.overallMatchScore);
    return;
  }
  if (type === "GENERATE_DOCUMENT") {
    const parsed = z.object({ id: z.string(), kind: z.enum(["cv", "cover-letter"]), language: z.enum(["fr", "en"]), userId: z.string() }).parse(payload);
    const [job, profile] = await Promise.all([db.job.findUniqueOrThrow({ where: { id: parsed.id }, include: { sources: true } }), db.candidateProfile.findUniqueOrThrow({ where: { userId: parsed.userId } })]);
    const generated = await generateDocument(candidateProfileSchema.parse(profile.data), normalizedFromStored(job), parsed.kind, parsed.language, usageHooks);
    const previous = await db.generatedDocument.aggregate({ where: { userId: parsed.userId, jobId: parsed.id, kind: parsed.kind, language: parsed.language }, _max: { version: true } });
    await db.generatedDocument.create({ data: { userId: parsed.userId, jobId: parsed.id, kind: parsed.kind, language: parsed.language, markdown: generated.document.markdown, version: (previous._max.version ?? 0) + 1, model: generated.usage.model, evidenceUsed: generated.document.evidenceUsed, suggestedLearning: generated.document.suggestedLearning } });
    return;
  }
  throw new Error(`Unknown task type: ${type}`);
}
