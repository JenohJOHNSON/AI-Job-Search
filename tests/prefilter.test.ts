import { describe, expect, it } from "vitest";
import { candidateProfileSchema, normalizedJobSchema, searchProfileInputSchema } from "@/lib/schemas";
import { prefilterJob } from "@/matching/prefilter";
const candidate = candidateProfileSchema.parse({ targetRoles: ["Product Manager"], coreSkills: ["product strategy", "GenAI"], locations: ["Paris"], remote: true, contractTypes: ["CDI"], excludedKeywords: ["unpaid"], minimumSalary: 60_000 });
const profile = searchProfileInputSchema.parse({ name: "AI PM", targetTitles: ["AI Product Manager"], locations: ["Paris"] });
describe("cheap prefilter", () => {
  it("rewards stored title, skills, location and style", () => { const job = normalizedJobSchema.parse({ source: "fixture", sourceJobId: "1", sourceUrl: "https://example.com/1", companyName: "Acme", title: "Senior AI Product Manager", location: "Paris", remoteType: "REMOTE", contractType: "CDI", descriptionClean: "Lead GenAI and product strategy", extractor: "fixture" }); expect(prefilterJob(candidate, job, [profile]).score).toBeGreaterThanOrEqual(70); });
  it("caps jobs with explicit exclusions", () => { const job = normalizedJobSchema.parse({ source: "fixture", sourceJobId: "2", sourceUrl: "https://example.com/2", companyName: "Acme", title: "Product Manager", descriptionClean: "This is an unpaid position", extractor: "fixture" }); const result = prefilterJob(candidate, job, [profile]); expect(result.score).toBeLessThanOrEqual(20); expect(result.hardRejects[0]).toContain("unpaid"); });
  it("rejects explicit salary below the stored minimum", () => { const job = normalizedJobSchema.parse({ source: "fixture", sourceJobId: "3", sourceUrl: "https://example.com/3", companyName: "Acme", title: "Product Manager", descriptionClean: "Product role", salaryMax: 50_000, extractor: "fixture" }); expect(prefilterJob(candidate, job, [profile]).hardRejects).toContain("Maximum stated salary is below the candidate minimum"); });
});
