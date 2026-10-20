import { z } from "zod";

const strings = z.array(z.string().trim().min(1).max(160)).max(100).default([]);
const longStrings = z.array(z.string().trim().min(1).max(600)).max(100).default([]);
const publicUrl = z.string().url().max(2_000).refine(value => ["https:", "http:"].includes(new URL(value).protocol), "URL must use HTTP or HTTPS.");

export const candidateProfileSchema = z.object({
  preferredName: z.string().trim().max(100).default(""),
  location: z.string().trim().max(160).default(""),
  workAuthorization: z.string().trim().max(300).default(""),
  languages: strings,
  currentTitle: z.string().trim().max(160).default(""),
  yearsExperience: z.coerce.number().min(0).max(80).default(0),
  targetRoles: strings,
  secondaryRoles: strings,
  targetIndustries: strings,
  preferredCompanyTypes: strings,
  seniorityLevels: strings,
  coreSkills: strings,
  secondarySkills: strings,
  tools: strings,
  technologies: strings,
  certifications: strings,
  locations: strings,
  maxCommuteKm: z.coerce.number().int().min(0).max(1000).nullable().default(null),
  remote: z.boolean().default(true),
  hybrid: z.boolean().default(true),
  onsite: z.boolean().default(false),
  relocation: z.boolean().default(false),
  travelTolerance: z.string().trim().max(160).default(""),
  minimumSalary: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
  preferredSalary: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
  currency: z.string().trim().length(3).default("EUR"),
  contractTypes: strings,
  excludedCompanies: strings,
  excludedIndustries: strings,
  excludedTitles: strings,
  excludedKeywords: strings,
  careerSummary: z.string().trim().max(8_000).default(""),
  achievements: longStrings,
  careerGoals: z.string().trim().max(4_000).default(""),
  strengths: strings,
  weaknesses: strings,
  desiredNextStep: z.string().trim().max(2_000).default("")
}).strict();

export type CandidateData = z.infer<typeof candidateProfileSchema>;
export const emptyCandidateProfile: CandidateData = candidateProfileSchema.parse({});

export const searchProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  targetTitles: strings,
  alternativeTitles: strings,
  keywords: strings,
  excludedKeywords: strings,
  locations: strings,
  remotePreferences: strings,
  salaryMin: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
  contractTypes: strings,
  seniority: strings,
  datePostedWindow: z.coerce.number().int().min(1).max(30).default(7),
  providers: strings,
  minimumMatchScore: z.coerce.number().int().min(0).max(100).default(40)
}).strict();
export type SearchProfileData = z.infer<typeof searchProfileInputSchema>;

export const normalizedJobSchema = z.object({
  source: z.string().trim().min(1).max(80),
  sourceJobId: z.string().trim().min(1).max(300),
  sourceUrl: publicUrl,
  applicationUrl: publicUrl.optional(),
  companyName: z.string().trim().min(1).max(300),
  companyDomain: z.string().trim().max(300).optional(),
  title: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).default("France"),
  country: z.string().trim().length(2).default("FR"),
  remoteType: z.enum(["UNKNOWN", "REMOTE", "HYBRID", "ONSITE"]).default("UNKNOWN"),
  contractType: z.string().trim().max(100).default("UNKNOWN"),
  salaryMin: z.number().int().nonnegative().nullable().default(null),
  salaryMax: z.number().int().nonnegative().nullable().default(null),
  salaryCurrency: z.string().length(3).default("EUR"),
  descriptionRaw: z.string().max(300_000).default(""),
  descriptionClean: z.string().max(200_000).default(""),
  skillsRequired: strings,
  languagesRequired: strings,
  experienceMin: z.number().int().min(0).max(80).nullable().default(null),
  publishedAt: z.string().datetime().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  extractor: z.string().trim().min(1).max(100),
  scope: z.string().trim().max(300).optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).default({})
}).strict();
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

const dimensionSchema = z.object({ score: z.number().int().min(0).max(100), reasoning: z.string().min(1).max(1_500) });
export const analysisSchema = z.object({
  overallMatchScore: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(2_000),
  dimensions: z.object({
    roleMatch: dimensionSchema,
    skillsMatch: dimensionSchema,
    experienceMatch: dimensionSchema,
    industryMatch: dimensionSchema,
    locationMatch: dimensionSchema,
    compensationMatch: dimensionSchema,
    seniorityMatch: dimensionSchema,
    careerGrowthMatch: dimensionSchema
  }),
  matchingSkills: strings,
  missingSkills: strings,
  transferableSkills: strings,
  strongPoints: longStrings,
  weakPoints: longStrings,
  hardRequirementsMet: longStrings,
  hardRequirementsMissing: longStrings,
  potentialRedFlags: longStrings,
  applicationRecommendation: z.enum(["STRONG_APPLY", "APPLY", "MAYBE", "SKIP"])
}).strict();
export type JobAnalysisResult = z.infer<typeof analysisSchema>;

export const applicationStatusSchema = z.enum(["NEW", "REVIEWED", "SAVED", "APPLY", "APPLIED", "RECRUITER_CONTACT", "INTERVIEW", "TECHNICAL_INTERVIEW", "FINAL_INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "ARCHIVED"]);
export const applicationInputSchema = z.object({
  status: applicationStatusSchema,
  notes: z.string().max(10_000).optional(),
  salaryDiscussed: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  contact: z.string().max(500).optional(),
  nextAction: z.string().max(1_000).optional(),
  nextActionDate: z.string().datetime().nullable().optional(),
  interviewDates: z.array(z.string().datetime()).max(50).optional()
}).strict();

export const manualJobSchema = z.object({
  title: z.string().trim().min(1).max(300),
  companyName: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).default("France"),
  descriptionClean: z.string().trim().min(1).max(200_000),
  sourceUrl: publicUrl,
  applicationUrl: publicUrl.optional(),
  remoteType: z.enum(["UNKNOWN", "REMOTE", "HYBRID", "ONSITE"]).default("UNKNOWN"),
  contractType: z.string().trim().max(100).default("UNKNOWN"),
  salaryMin: z.coerce.number().int().min(0).nullable().optional(),
  salaryMax: z.coerce.number().int().min(0).nullable().optional()
}).strict();

/** Accepts a bare slug or a pasted board URL (https://boards.greenhouse.io/acme/jobs/1) and returns the slug. */
export function boardSlug(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(trimmed)) {
    try { const first = new URL(/^https?:/i.test(trimmed) ? trimmed : `https://${trimmed}`).pathname.split("/").filter(Boolean)[0]; return first ?? ""; } catch { return ""; }
  }
  return trimmed;
}
const slug = z.string().transform(boardSlug).pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, "Board names may only contain letters, digits, dots, dashes and underscores."));
const hostname = z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, "Enter a host name such as careers.example.com.");
const httpsUrl = z.string().trim().url().max(2_000).refine(value => new URL(value).protocol === "https:", "Career page URLs must use HTTPS.");

export const providerPatchSchema = z.object({
  enabled: z.boolean().optional(),
  maxJobs: z.coerce.number().int().min(1).max(500).optional(),
  rateLimitMs: z.coerce.number().int().min(100).max(60_000).optional(),
  strategies: z.array(z.string().max(100)).max(10).optional(),
  config: z.object({ boards: z.array(slug).max(100), urls: z.array(httpsUrl).max(100), allowedHosts: z.array(hostname).max(100) }).partial().superRefine((value, context) => {
    for (const url of value.urls ?? []) {
      const host = new URL(url).hostname;
      if (!(value.allowedHosts ?? []).some(allowed => host === allowed || host.endsWith(`.${allowed}`))) context.addIssue({ code: "custom", message: `${host} must be listed in allowed hosts.` });
    }
  }).optional()
}).strict();

export function parseJson<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
