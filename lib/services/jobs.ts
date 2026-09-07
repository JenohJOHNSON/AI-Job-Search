import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canonicalJobHash, contentFingerprint, normalizeText, tokenSimilarity } from "@/lib/deduplication";
import type { NormalizedJob } from "@/lib/schemas";

export const jobInclude = { sources: { orderBy: [{ isPrimary: "desc" as const }, { firstSeenAt: "asc" as const }] }, analyses: { orderBy: { createdAt: "desc" as const } }, application: { include: { history: { orderBy: { createdAt: "desc" as const } } } } };
export function serializeJob<T extends { sources: { sourceUrl: string; isPrimary: boolean }[]; applicationUrl: string }>(job: T) { return { ...job, sourceUrl: job.sources.find(source => source.isPrimary)?.sourceUrl ?? job.sources[0]?.sourceUrl ?? job.applicationUrl }; }

export async function ingestJob(job: NormalizedJob) {
  const canonicalHash = canonicalJobHash(job.companyName, job.title, job.location); const fingerprint = contentFingerprint(job.descriptionClean);
  const exactSource = await db.jobPostingSource.findFirst({ where: { OR: [{ sourceUrl: job.sourceUrl }, { provider: job.source, sourceJobId: job.sourceJobId }] }, include: { job: true } });
  if (exactSource) { const materiallyChanged = exactSource.job.contentFingerprint !== fingerprint; const [, updated] = await db.$transaction([db.jobPostingSource.update({ where: { id: exactSource.id }, data: { lastSeenAt: new Date(), sourceMetadata: job.sourceMetadata as Prisma.InputJsonValue } }), db.job.update({ where: { id: exactSource.job.id }, data: materiallyChanged ? { descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, contentFingerprint: fingerprint, publishedAt: job.publishedAt ? new Date(job.publishedAt) : exactSource.job.publishedAt } : {} })]); return { job: updated, duplicate: true, materiallyChanged }; }
  let canonical = await db.job.findUnique({ where: { canonicalHash } });
  if (!canonical) canonical = await db.job.findFirst({ where: { contentFingerprint: fingerprint } });
  if (!canonical) {
    const candidates = await db.job.findMany({ where: { companyName: { equals: job.companyName, mode: "insensitive" }, status: "ACTIVE" }, take: 20 });
    canonical = candidates.find(candidate => tokenSimilarity(`${candidate.title} ${candidate.location}`, `${job.title} ${job.location}`) >= 0.85) ?? null;
  }
  const sourceIsAts = ["greenhouse", "lever", "ashby", "generic", "france_travail"].includes(job.source);
  if (canonical) {
    await db.$transaction([
      db.jobPostingSource.create({ data: { provider: job.source, sourceJobId: job.sourceJobId, sourceUrl: job.sourceUrl, extractor: job.extractor, sourceMetadata: job.sourceMetadata as Prisma.InputJsonValue, isPrimary: sourceIsAts, jobId: canonical.id } }),
      db.job.update({ where: { id: canonical.id }, data: { applicationUrl: sourceIsAts ? job.applicationUrl ?? job.sourceUrl : canonical.applicationUrl, ...(canonical.contentFingerprint !== fingerprint && job.descriptionClean.length > canonical.descriptionClean.length ? { descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, contentFingerprint: fingerprint } : {}) } })
    ]);
    return { job: canonical, duplicate: true, materiallyChanged: canonical.contentFingerprint !== fingerprint };
  }
  const created = await db.job.create({ data: { canonicalHash, contentFingerprint: fingerprint, companyName: job.companyName, companyDomain: job.companyDomain, title: job.title, normalizedTitle: normalizeText(job.title), location: job.location, country: job.country, remoteType: job.remoteType, contractType: job.contractType, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, skillsRequired: job.skillsRequired, languagesRequired: job.languagesRequired, experienceMin: job.experienceMin, publishedAt: job.publishedAt ? new Date(job.publishedAt) : null, expiresAt: job.expiresAt ? new Date(job.expiresAt) : null, applicationUrl: job.applicationUrl ?? job.sourceUrl, sources: { create: { provider: job.source, sourceJobId: job.sourceJobId, sourceUrl: job.sourceUrl, extractor: job.extractor, sourceMetadata: job.sourceMetadata as Prisma.InputJsonValue, isPrimary: true } } } });
  return { job: created, duplicate: false, materiallyChanged: false };
}

export function normalizedFromStored(job: { id: string; title: string; companyName: string; companyDomain: string | null; location: string; country: string; remoteType: string; contractType: string; salaryMin: number | null; salaryMax: number | null; salaryCurrency: string; descriptionRaw: string; descriptionClean: string; skillsRequired: Prisma.JsonValue; languagesRequired: Prisma.JsonValue; experienceMin: number | null; publishedAt: Date | null; expiresAt: Date | null; applicationUrl: string; sources: { provider: string; sourceJobId: string; sourceUrl: string; extractor: string; sourceMetadata: Prisma.JsonValue }[] }): NormalizedJob {
  const source = job.sources[0]; if (!source) throw new Error("Stored job has no posting source."); return { source: source.provider, sourceJobId: source.sourceJobId, sourceUrl: source.sourceUrl, applicationUrl: job.applicationUrl, companyName: job.companyName, ...(job.companyDomain ? { companyDomain: job.companyDomain } : {}), title: job.title, location: job.location, country: job.country, remoteType: job.remoteType as NormalizedJob["remoteType"], contractType: job.contractType, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, descriptionRaw: job.descriptionRaw, descriptionClean: job.descriptionClean, skillsRequired: Array.isArray(job.skillsRequired) ? job.skillsRequired.filter((v): v is string => typeof v === "string") : [], languagesRequired: Array.isArray(job.languagesRequired) ? job.languagesRequired.filter((v): v is string => typeof v === "string") : [], experienceMin: job.experienceMin, publishedAt: job.publishedAt?.toISOString() ?? null, expiresAt: job.expiresAt?.toISOString() ?? null, extractor: source.extractor, sourceMetadata: source.sourceMetadata && typeof source.sourceMetadata === "object" && !Array.isArray(source.sourceMetadata) ? source.sourceMetadata as Record<string, unknown> : {} };
}
