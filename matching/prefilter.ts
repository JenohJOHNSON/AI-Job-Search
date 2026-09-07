import type { CandidateData, NormalizedJob, SearchProfileData } from "@/lib/schemas";
import { normalizeText } from "@/lib/deduplication";

export function prefilterJob(candidate: CandidateData, job: NormalizedJob, profiles: SearchProfileData[]) {
  const haystack = normalizeText(`${job.title} ${job.descriptionClean} ${job.location} ${job.companyName}`);
  const lowerCompany = normalizeText(job.companyName); const lowerTitle = normalizeText(job.title);
  const excluded = [...candidate.excludedKeywords, ...candidate.excludedCompanies.filter(v => lowerCompany.includes(normalizeText(v))), ...candidate.excludedTitles.filter(v => lowerTitle.includes(normalizeText(v))), ...profiles.flatMap(p => p.excludedKeywords)];
  const hardRejects = excluded.filter(term => haystack.includes(normalizeText(term))).map(term => `Excluded term: ${term}`);
  let score = 0; const reasons: string[] = [];
  const titles = [...candidate.targetRoles, ...candidate.secondaryRoles, ...profiles.flatMap(p => [...p.targetTitles, ...p.alternativeTitles])];
  if (titles.some(title => lowerTitle.includes(normalizeText(title)) || normalizeText(title).includes(lowerTitle))) { score += 35; reasons.push("Target title match"); }
  const skills = [...candidate.coreSkills, ...candidate.secondarySkills, ...candidate.tools, ...candidate.technologies];
  const skillHits = skills.filter(skill => haystack.includes(normalizeText(skill)));
  score += Math.min(30, skillHits.length * 5); if (skillHits.length) reasons.push(`${skillHits.length} stored skills found`);
  const locations = [...candidate.locations, ...profiles.flatMap(p => p.locations)];
  if (!locations.length || locations.some(location => normalizeText(job.location).includes(normalizeText(location)))) { score += 15; reasons.push("Location preference match"); }
  if ((job.remoteType === "REMOTE" && candidate.remote) || (job.remoteType === "HYBRID" && candidate.hybrid) || (job.remoteType === "ONSITE" && candidate.onsite)) { score += 10; reasons.push("Work-style match"); }
  if (!candidate.contractTypes.length || candidate.contractTypes.some(contract => normalizeText(job.contractType).includes(normalizeText(contract)))) score += 10;
  if (candidate.minimumSalary && job.salaryMax !== null && job.salaryMax < candidate.minimumSalary) hardRejects.push("Maximum stated salary is below the candidate minimum");
  if (hardRejects.length) score = Math.min(score, 20);
  return { score: Math.min(100, score), hardRejects: [...new Set(hardRejects)], reasons };
}
