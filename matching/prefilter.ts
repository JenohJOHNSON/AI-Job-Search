import type { CandidateData, NormalizedJob, SearchProfileData } from "@/lib/schemas";
import { scoreJob } from "@/matching/score";

/** Compatibility wrapper: the cheap pre-filter is now the full rule-based engine in `score.ts`. */
export function prefilterJob(candidate: CandidateData, job: NormalizedJob, profiles: SearchProfileData[]) {
  const result = scoreJob(candidate, job, profiles);
  return { score: result.score, hardRejects: result.blockers, reasons: result.components.flatMap(component => component.evidence) };
}
