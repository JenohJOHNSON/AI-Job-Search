import { Prisma } from "@prisma/client";
import { z } from "zod";
import { evaluateJob, extractProfile, generateDocument } from "@/ai";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { candidateProfileSchema } from "@/lib/schemas";
import { normalizedFromStored } from "@/lib/services/jobs";
import { sendDailyDigest } from "@/lib/services/notifications";
import { enqueueTask } from "@/lib/services/queue";
import { processSearchRun } from "@/lib/services/search";
import { usageHooks } from "@/lib/services/usage";

const idPayload = z.object({ id: z.string().min(1) });
export async function processTask(type: string, payload: Prisma.JsonValue) {
  if (type === "SEARCH_RUN") { const { runId } = z.object({ runId: z.string() }).parse(payload); await processSearchRun(runId); await enqueueTask("SEND_DIGEST", { runId }, `digest:${runId}`); return; }
  if (type === "SEND_DIGEST") { await sendDailyDigest(); return; }
  if (type === "EXTRACT_RESUME") { const { id } = idPayload.parse(payload); const resume = await db.resume.findUniqueOrThrow({ where: { id } }); const extracted = await extractProfile(resume.sourceText, usageHooks); await db.resume.update({ where: { id }, data: { suggestions: extracted.suggestions, extractionStatus: "PENDING_REVIEW" } }); return; }
  if (type === "ANALYZE_JOB") { const { id } = idPayload.parse(payload); const [job, user] = await Promise.all([db.job.findUniqueOrThrow({ where: { id }, include: { sources: true } }), db.user.findFirst({ include: { profile: true } })]); if (!user?.profile) throw new Error("Candidate profile is required."); const candidate = candidateProfileSchema.parse(user.profile.data); const normalized = normalizedFromStored(job); const analyzed = await evaluateJob(candidate, normalized, usageHooks); const env = config(); const cost = analyzed.usage.inputTokens * (env.AI_INPUT_PRICE_PER_MILLION ?? 0) / 1_000_000 + analyzed.usage.outputTokens * (env.AI_OUTPUT_PRICE_PER_MILLION ?? 0) / 1_000_000; await db.jobAnalysis.upsert({ where: { jobId_profileVersion_contentFingerprint: { jobId: id, profileVersion: user.profile.version, contentFingerprint: job.contentFingerprint } }, create: { jobId: id, profileVersion: user.profile.version, contentFingerprint: job.contentFingerprint, result: analyzed.result, score: analyzed.result.overallMatchScore, recommendation: analyzed.result.applicationRecommendation, confidence: analyzed.result.confidence, model: analyzed.usage.model, provider: env.AI_PROVIDER, inputTokens: analyzed.usage.inputTokens, outputTokens: analyzed.usage.outputTokens, estimatedCost: new Prisma.Decimal(cost) }, update: { result: analyzed.result, score: analyzed.result.overallMatchScore, recommendation: analyzed.result.applicationRecommendation, confidence: analyzed.result.confidence, model: analyzed.usage.model, provider: env.AI_PROVIDER, inputTokens: analyzed.usage.inputTokens, outputTokens: analyzed.usage.outputTokens, estimatedCost: new Prisma.Decimal(cost), createdAt: new Date() } }); await db.job.update({ where: { id }, data: { matchScore: analyzed.result.overallMatchScore } }); return; }
  if (type === "GENERATE_DOCUMENT") { const parsed = z.object({ id: z.string(), kind: z.enum(["cv", "cover-letter"]), language: z.enum(["fr", "en"]), userId: z.string() }).parse(payload); const [job, profile] = await Promise.all([db.job.findUniqueOrThrow({ where: { id: parsed.id }, include: { sources: true } }), db.candidateProfile.findUniqueOrThrow({ where: { userId: parsed.userId } })]); const generated = await generateDocument(candidateProfileSchema.parse(profile.data), normalizedFromStored(job), parsed.kind, parsed.language, usageHooks); await db.generatedDocument.create({ data: { userId: parsed.userId, jobId: parsed.id, kind: parsed.kind, language: parsed.language, markdown: generated.document.markdown } }); return; }
  throw new Error(`Unknown task type: ${type}`);
}
