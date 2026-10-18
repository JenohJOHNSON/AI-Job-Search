import { db } from "@/lib/db";
import { candidateProfileSchema, searchProfileInputSchema, type CandidateData, type SearchProfileData } from "@/lib/schemas";
import { normalizedFromStored, saveMatch } from "@/lib/services/jobs";
import { scoreJob } from "@/matching/score";

export type MatchingContext = { userId: string; candidate: CandidateData; profileVersion: number; profiles: SearchProfileData[]; allProfiles: number };

/** The owner's reviewed profile plus the enabled search profiles that steer matching. Null until a profile exists. */
export async function loadMatchingContext(): Promise<MatchingContext | null> {
  const user = await db.user.findFirst({ include: { profile: true, searchProfiles: true } });
  if (!user?.profile) return null;
  const profiles = user.searchProfiles.filter(profile => profile.enabled).map(profile => searchProfileInputSchema.parse(profile.data));
  return { userId: user.id, candidate: candidateProfileSchema.parse(user.profile.data), profileVersion: user.profile.version, profiles, allProfiles: user.searchProfiles.length };
}

/** Recomputes the rule-based score for stored vacancies after the profile changed. Pure CPU and database work: no AI cost. */
export async function rescoreJobs(batchSize = 200) {
  const context = await loadMatchingContext(); if (!context) return { rescored: 0 };
  let rescored = 0, cursor: string | undefined;
  for (;;) {
    const jobs = await db.job.findMany({ where: { status: "ACTIVE" }, include: { sources: true }, orderBy: { id: "asc" }, take: batchSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!jobs.length) break;
    for (const job of jobs) { try { await saveMatch(job.id, scoreJob(context.candidate, normalizedFromStored(job), context.profiles), context.profileVersion); rescored++; } catch { /* a stored job without a source cannot be rescored */ } }
    cursor = jobs[jobs.length - 1]!.id;
  }
  return { rescored };
}
