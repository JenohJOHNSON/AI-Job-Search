import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canonicalJobHash, cleanLocation, cleanTitle, contentFingerprint, normalizeText, tokenSimilarity } from "@/lib/deduplication";
import type { NormalizedJob } from "@/lib/schemas";
import type { MatchResult } from "@/matching/score";

export const jobInclude = { sources: { orderBy: [{ isPrimary: "desc" as const }, { firstSeenAt: "asc" as const }] }, analyses: { orderBy: { createdAt: "desc" as const } }, application: { include: { history: { orderBy: { createdAt: "desc" as const } } } } };
export function serializeJob<T extends { sources: { sourceUrl: string; isPrimary: boolean }[]; applicationUrl: string }>(job: T) { return { ...job, sourceUrl: job.sources.find(source => source.isPrimary)?.sourceUrl ?? job.sources[0]?.sourceUrl ?? job.applicationUrl }; }

// Employer-hosted applications are preferred over aggregator pages as the direct application link.
const employerSources = new Set(["greenhouse", "lever", "ashby", "generic"]);
const sourceData = (job: NormalizedJob, seenAt: Date) => ({ provider: job.source, sourceJobId: job.sourceJobId, sourceUrl: job.sourceUrl, extractor: job.extractor, scope: job.scope ?? null, sourceMetadata: job.sourceMetadata as Prisma.InputJsonValue, lastSeenAt: seenAt, removedAt: null });

/** A fingerprint match only counts for long descriptions of the same company, title and place; empty or boilerplate text must not merge unrelated vacancies. */
function sameVacancy(existing: { title: string; location: string; contentFingerprint: string; descriptionClean: string }, job: NormalizedJob, fingerprint: string) {
  const titleSimilarity = tokenSimilarity(cleanTitle(existing.title), cleanTitle(job.title)); const placeSimilarity = !existing.location || !job.location ? 1 : tokenSimilarity(cleanLocation(existing.location), cleanLocation(job.location));
  if (titleSimilarity >= 0.85 && placeSimilarity >= 0.5) return true;
  return existing.contentFingerprint === fingerprint && normalizeText(job.descriptionClean).length >= 200 && titleSimilarity >= 0.6 && placeSimilarity >= 0.5;
}

export async function ingestJob(job: NormalizedJob, seenAt = new Date()) {
  const canonicalHash = canonicalJobHash(job.companyName, job.title, job.location); const fingerprint = contentFingerprint(job.descriptionClean);
  const exact = await db.jobPostingSource.findFirst({ where: { OR: [{ sourceUrl: job.sourceUrl }, { provider: job.source, sourceJobId: job.sourceJobId }] }, include: { job: true } });
  if (exact) {
    const materiallyChanged = exact.job.contentFingerprint !== fingerprint;
    const [, updated] = await db.$transaction([
      db.jobPostingSource.update({ where: { id: exact.id }, data: sourceData(job, seenAt) }),
      db.job.update({ where: { id: exact.job.id }, data: { lastSeenAt: seenAt, ...(exact.job.status === "REMOVED" ? { status: "ACTIVE", statusChangedAt: seenAt } : {}), expiresAt: job.expiresAt ? new Date(job.expiresAt) : exact.job.expiresAt, ...(materiallyChanged ? { descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, contentFingerprint: fingerprint, publishedAt: job.publishedAt ? new Date(job.publishedAt) : exact.job.publishedAt } : {}) } })
    ]);
    return { job: updated, duplicate: true, materiallyChanged };
  }
  let canonical = await db.job.findUnique({ where: { canonicalHash } });
  if (!canonical) {
    const candidates = await db.job.findMany({ where: { companyName: { equals: job.companyName, mode: "insensitive" } }, orderBy: { discoveredAt: "desc" }, take: 100 });
    canonical = candidates.find(candidate => sameVacancy(candidate, job, fingerprint)) ?? null;
  }
  if (canonical) {
    const employerHosted = employerSources.has(job.source); const longer = canonical.contentFingerprint !== fingerprint && job.descriptionClean.length > canonical.descriptionClean.length;
    const [, updated] = await db.$transaction([
      db.jobPostingSource.create({ data: { ...sourceData(job, seenAt), isPrimary: false, jobId: canonical.id } }),
      db.job.update({ where: { id: canonical.id }, data: { lastSeenAt: seenAt, ...(canonical.status === "REMOVED" ? { status: "ACTIVE", statusChangedAt: seenAt } : {}), ...(employerHosted ? { applicationUrl: job.applicationUrl ?? job.sourceUrl } : {}), ...(longer ? { descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, contentFingerprint: fingerprint } : {}) } })
    ]);
    return { job: updated, duplicate: true, materiallyChanged: longer };
  }
  const created = await db.job.create({ data: { canonicalHash, contentFingerprint: fingerprint, companyName: job.companyName, companyDomain: job.companyDomain, title: job.title, normalizedTitle: normalizeText(job.title), location: job.location, country: job.country, remoteType: job.remoteType, contractType: job.contractType, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, skillsRequired: job.skillsRequired, languagesRequired: job.languagesRequired, experienceMin: job.experienceMin, publishedAt: job.publishedAt ? new Date(job.publishedAt) : null, expiresAt: job.expiresAt ? new Date(job.expiresAt) : null, applicationUrl: job.applicationUrl ?? job.sourceUrl, lastSeenAt: seenAt, sources: { create: { ...sourceData(job, seenAt), isPrimary: true } } } });
  return { job: created, duplicate: false, materiallyChanged: false };
}

/** Combines the rule-based result with an optional AI score. AI can refine a score but never lift a job past a hard blocker. */
export function effectiveScore(rule: number, ai: number | null | undefined, blockers: string[]) {
  if (ai === null || ai === undefined) return rule;
  return blockers.length ? Math.min(ai, 35) : ai;
}

export async function saveMatch(jobId: string, match: MatchResult, profileVersion: number, aiScore?: number | null) {
  const current = aiScore === undefined ? await db.job.findUnique({ where: { id: jobId }, select: { matchScore: true } }) : null; const ai = aiScore === undefined ? current?.matchScore : aiScore;
  return db.job.update({ where: { id: jobId }, data: { preliminaryScore: match.score, matchDetails: match as unknown as Prisma.InputJsonValue, matchProfileVersion: profileVersion, rankScore: effectiveScore(match.score, ai, match.blockers) } });
}

export function normalizedFromStored(job: { id: string; title: string; companyName: string; companyDomain: string | null; location: string; country: string; remoteType: string; contractType: string; salaryMin: number | null; salaryMax: number | null; salaryCurrency: string; descriptionRaw: string; descriptionClean: string; skillsRequired: Prisma.JsonValue; languagesRequired: Prisma.JsonValue; experienceMin: number | null; publishedAt: Date | null; expiresAt: Date | null; applicationUrl: string; sources: { provider: string; sourceJobId: string; sourceUrl: string; extractor: string; sourceMetadata: Prisma.JsonValue }[] }): NormalizedJob {
  const source = job.sources[0]; if (!source) throw new Error("Stored job has no posting source.");
  const strings = (value: Prisma.JsonValue) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return { source: source.provider, sourceJobId: source.sourceJobId, sourceUrl: source.sourceUrl, applicationUrl: job.applicationUrl, companyName: job.companyName, ...(job.companyDomain ? { companyDomain: job.companyDomain } : {}), title: job.title, location: job.location, country: job.country, remoteType: job.remoteType as NormalizedJob["remoteType"], contractType: job.contractType, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, skillsRequired: strings(job.skillsRequired), languagesRequired: strings(job.languagesRequired), experienceMin: job.experienceMin, publishedAt: job.publishedAt?.toISOString() ?? null, expiresAt: job.expiresAt?.toISOString() ?? null, extractor: source.extractor, sourceMetadata: source.sourceMetadata && typeof source.sourceMetadata === "object" && !Array.isArray(source.sourceMetadata) ? source.sourceMetadata as Record<string, unknown> : {} };
}
