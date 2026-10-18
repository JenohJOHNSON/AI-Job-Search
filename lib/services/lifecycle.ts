import { db } from "@/lib/db";
import type { Coverage, JobProvider } from "@/providers/types";

/** Marks jobs REMOVED when every posting source is gone, and ACTIVE again when any source is live. */
async function syncStatus(jobIds: string[]) {
  if (!jobIds.length) return { removed: 0, reactivated: 0 };
  const removed = await db.$executeRaw`UPDATE "Job" j SET status = 'REMOVED', "statusChangedAt" = (NOW() AT TIME ZONE 'UTC') WHERE j.id = ANY(${jobIds}) AND j.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM "JobPostingSource" s WHERE s."jobId" = j.id AND s."removedAt" IS NULL)`;
  const reactivated = await db.$executeRaw`UPDATE "Job" j SET status = 'ACTIVE', "statusChangedAt" = (NOW() AT TIME ZONE 'UTC') WHERE j.id = ANY(${jobIds}) AND j.status = 'REMOVED' AND EXISTS (SELECT 1 FROM "JobPostingSource" s WHERE s."jobId" = j.id AND s."removedAt" IS NULL)`;
  return { removed, reactivated };
}

/**
 * Applies complete-listing coverage from a provider. A source that was listed before but is missing from a fully
 * fetched board is marked removed. An empty listing for a board that previously had openings is treated as a
 * suspect response (API glitch) and changes nothing.
 */
export async function reconcileCoverage(provider: string, coverage: Coverage[], seenAt: Date) {
  let removed = 0, reactivated = 0; const warnings: string[] = [];
  for (const { scope, sourceJobIds } of coverage) {
    const seen = new Set(sourceJobIds);
    const touched = new Set<string>();
    if (seen.size) {
      const live = await db.jobPostingSource.findMany({ where: { provider, scope, sourceJobId: { in: [...seen] } }, select: { id: true, jobId: true, removedAt: true } });
      await db.jobPostingSource.updateMany({ where: { id: { in: live.map(item => item.id) } }, data: { lastSeenAt: seenAt, removedAt: null } });
      await db.job.updateMany({ where: { id: { in: [...new Set(live.map(item => item.jobId))] } }, data: { lastSeenAt: seenAt } });
      for (const item of live) if (item.removedAt) touched.add(item.jobId);
    }
    const known = await db.jobPostingSource.findMany({ where: { provider, scope, removedAt: null }, select: { id: true, jobId: true, sourceJobId: true } });
    const missing = known.filter(item => !seen.has(item.sourceJobId));
    if (!seen.size && missing.length) { warnings.push(`${scope}: the listing is empty but ${missing.length} openings were known; treating it as a temporary glitch, nothing was marked removed.`); continue; }
    if (missing.length) { await db.jobPostingSource.updateMany({ where: { id: { in: missing.map(item => item.id) } }, data: { removedAt: seenAt } }); for (const item of missing) touched.add(item.jobId); }
    const result = await syncStatus([...touched]); removed += result.removed; reactivated += result.reactivated;
  }
  return { removed, reactivated, warnings };
}

/** Jobs with a passed `expiresAt` (schema.org validThrough, etc.) become EXPIRED. */
export async function expireByDate(now = new Date()) {
  return db.job.updateMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, data: { status: "EXPIRED", statusChangedAt: now } });
}

/** For search-based sources that cannot report full coverage: ask the provider whether older offers still exist. */
export async function verifyStale(provider: JobProvider, staleAfterDays = 7, limit = 40) {
  if (!provider.verify) return { checked: 0, removed: 0 };
  const cutoff = new Date(Date.now() - staleAfterDays * 86_400_000);
  const sources = await db.jobPostingSource.findMany({ where: { provider: provider.id, removedAt: null, lastSeenAt: { lt: cutoff }, job: { status: "ACTIVE" } }, orderBy: { lastSeenAt: "asc" }, take: limit, select: { id: true, jobId: true, sourceJobId: true } });
  if (!sources.length) return { checked: 0, removed: 0 };
  const verdicts = await provider.verify(sources.map(item => item.sourceJobId)); const now = new Date();
  const gone = sources.filter(item => verdicts[item.sourceJobId] === "GONE"); const alive = sources.filter(item => verdicts[item.sourceJobId] === "ACTIVE");
  if (gone.length) await db.jobPostingSource.updateMany({ where: { id: { in: gone.map(item => item.id) } }, data: { removedAt: now } });
  if (alive.length) { await db.jobPostingSource.updateMany({ where: { id: { in: alive.map(item => item.id) } }, data: { lastSeenAt: now } }); await db.job.updateMany({ where: { id: { in: alive.map(item => item.jobId) } }, data: { lastSeenAt: now } }); }
  const { removed } = await syncStatus([...new Set(gone.map(item => item.jobId))]);
  return { checked: sources.length, removed };
}
