export type Analysis = {
  overallMatchScore: number; confidence: number; summary: string;
  dimensions: Record<string, { score: number; reasoning: string }>;
  matchingSkills: string[]; missingSkills: string[]; transferableSkills: string[];
  strongPoints: string[]; weakPoints: string[]; hardRequirementsMet: string[];
  hardRequirementsMissing: string[]; potentialRedFlags: string[]; applicationRecommendation: string;
};
export type MatchLabel = 'STRONG' | 'GOOD' | 'POSSIBLE' | 'LOW';
export type MatchComponent = { key: string; label: string; score: number; max: number; evidence: string[]; gaps: string[]; uncertain: string[] };
export type MatchDetails = {
  engineVersion: number; score: number; label: MatchLabel; confidence: number; components: MatchComponent[];
  matchedSkills: { skill: string; evidence: string }[]; missingSkills: string[]; transferableSkills: string[];
  blockers: string[]; uncertain: string[]; summary: string;
};
export const applicationStatuses = ['NEW', 'REVIEWED', 'SAVED', 'APPLY', 'APPLIED', 'RECRUITER_CONTACT', 'INTERVIEW', 'TECHNICAL_INTERVIEW', 'FINAL_INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN', 'ARCHIVED'] as const;
export type ApplicationStatus = typeof applicationStatuses[number];
export type HistoryEntry = { id?: string; fromStatus: string | null; toStatus: string; note?: string | null; createdAt: string };
export type Application = {
  id: string; jobId: string; status: ApplicationStatus; notes: string | null;
  salaryDiscussed: number | null; contact: string | null; nextAction: string | null;
  nextActionDate: string | null; interviewDates: string[]; appliedAt: string | null;
  history?: HistoryEntry[];
  job: Job;
};
export type Job = {
  id: string; title: string; companyName: string; location: string | null;
  remoteType: string | null; contractType: string | null; salaryMin: number | null;
  salaryMax: number | null; salaryCurrency: string; sourceUrl: string; applicationUrl: string | null;
  descriptionClean: string; matchScore: number | null; preliminaryScore: number | null; rankScore: number | null; matchLabel?: MatchLabel | null;
  matchDetails?: MatchDetails | null;
  publishedAt: string | null; discoveredAt: string; lastSeenAt?: string; statusChangedAt?: string | null; dismissedAt?: string | null; status: string;
  sources?: { provider: string; sourceUrl: string; removedAt?: string | null }[];
  application?: Application | null; analyses?: { result: Analysis; model: string; createdAt: string }[];
};
export type Provider = {
  id: string; name: string; enabled: boolean; supported: boolean; maxJobs: number; rateLimitMs: number;
  strategies: string[]; config: { boards?: string[]; urls?: string[]; allowedHosts?: string[] };
  method?: string; description?: string; credentialsConfigured?: boolean;
  status: string; message: string | null; lastSuccessAt: string | null; jobsDiscovered: number; errorRate: number;
};
export type Run = {
  id: string; status: string; trigger: string; startedAt: string | null; completedAt: string | null;
  createdAt: string; providersAttempted: number; providersSuccessful: number; providersFailed: number;
  jobsDiscovered: number; jobsNew: number; jobsDuplicate: number; jobsAnalyzed: number; jobsHighMatch: number;
  errors: { provider: string; code: string; message: string }[] | unknown; providerRuns?: { provider: string; status: string; jobsDiscovered?: number; errorMessage?: string | null; durationMs?: number; extractorStats?: Record<string, number> }[];
};
export type CandidateData = {
  preferredName: string; location: string; workAuthorization: string; languages: string[];
  currentTitle: string; yearsExperience: number; targetRoles: string[]; secondaryRoles: string[];
  targetIndustries: string[]; preferredCompanyTypes: string[]; seniorityLevels: string[];
  coreSkills: string[]; secondarySkills: string[]; tools: string[]; technologies: string[]; certifications: string[];
  locations: string[]; maxCommuteKm: number | null; remote: boolean; hybrid: boolean; onsite: boolean;
  relocation: boolean; travelTolerance: string; minimumSalary: number | null; preferredSalary: number | null;
  currency: string; contractTypes: string[]; excludedCompanies: string[]; excludedIndustries: string[];
  excludedTitles: string[]; excludedKeywords: string[]; careerSummary: string; achievements: string[];
  careerGoals: string; strengths: string[]; weaknesses: string[]; desiredNextStep: string;
};
export type Resume = { id: string; fileName: string; createdAt: string; extractionStatus?: string; suggestions?: Partial<CandidateData> | null };
export type SearchProfile = {
  id: string; name: string; enabled: boolean; targetTitles: string[]; alternativeTitles: string[];
  keywords: string[]; excludedKeywords: string[]; locations: string[]; remotePreferences: string[];
  salaryMin: number | null; contractTypes: string[]; seniority: string[]; datePostedWindow: number;
  providers: string[]; minimumMatchScore: number;
};
export type Settings = {
  ai: { provider: string; model: string; configured: boolean; missing: string[]; fallbackModel: string };
  limits: { maxAiAnalysesPerDay: number; maxLlmCostPerDay: number; aiMatchThreshold: number; maxJobsPerProvider: number; maxTotalJobsPerRun: number; notificationScoreThreshold: number };
  ceilings: { maxAiAnalysesPerDay: number; maxLlmCostPerDay: number; maxJobsPerProvider: number; maxTotalJobsPerRun: number };
  notifications: { emailEnabled: boolean; telegramEnabled: boolean; minScore: number; maxPerDigest: number; emailAvailable: boolean; telegramAvailable: boolean };
  schedule: { enabled: boolean; time: string; timezone: string }; appUrl: string;
};
export const matchLabelText: Record<MatchLabel, string> = { STRONG: 'Strong Match', GOOD: 'Good Match', POSSIBLE: 'Possible Match', LOW: 'Low Match' };
export const labelFor = (score: number | null | undefined): MatchLabel | null => score === null || score === undefined ? null : score >= 80 ? 'STRONG' : score >= 65 ? 'GOOD' : score >= 50 ? 'POSSIBLE' : 'LOW';
