import { describe, expect, it } from "vitest";
import { candidateProfileSchema } from "@/lib/schemas";
import { expandTitles } from "@/matching/queries";
import { labelFor, scoreJob } from "@/matching/score";
import { candidate, job, searchProfile, strongDescription } from "@/tests/fixtures/candidate";

const run = (overrides: Record<string, unknown>, who = candidate) => scoreJob(who, job(overrides), [searchProfile]);
const component = (result: ReturnType<typeof run>, key: string) => result.components.find(item => item.key === key)!;

describe("rule-based matching", () => {
  it("scores a French data-engineering role in Metz as a strong match with evidence", () => {
    const result = run({ title: "Ingénieur Data (H/F)", location: "Metz", contractType: "CDI", descriptionClean: strongDescription });
    expect(result.score).toBeGreaterThanOrEqual(80); expect(result.label).toBe("STRONG"); expect(result.blockers).toEqual([]);
    expect(result.matchedSkills.map(item => item.skill)).toEqual(expect.arrayContaining(["SQL Server", "SSIS", "Python", "Azure Data Factory"]));
    expect(result.matchedSkills.find(item => item.skill === "SSIS")?.evidence).toBe("coreSkills: SSIS");
    expect(result.components.reduce((sum, item) => sum + item.max, 0)).toBe(100);
  });
  it("treats Luxembourg as a cross-border commute from Metz", () => {
    const result = run({ title: "Data Engineer", location: "Luxembourg-Kirchberg", descriptionClean: "Build data pipelines with Python and Azure. SQL required. CDI. 3 years of experience." });
    expect(component(result, "location").evidence.join(" ")).toContain("cross-border"); expect(result.score).toBeGreaterThanOrEqual(65);
  });
  it("accepts fully remote roles in France or across Europe", () => {
    expect(component(run({ title: "Azure Data Engineer", location: "Remote - France", remoteType: "REMOTE", descriptionClean: "Azure Data Factory, SQL." }), "location").score).toBe(20);
    expect(component(run({ title: "Data Engineer", location: "Europe", remoteType: "REMOTE", descriptionClean: "Python and SQL." }), "location").score).toBeGreaterThanOrEqual(15);
  });
  it("infers remote and hybrid work from the description", () => {
    expect(component(run({ title: "Data Engineer", location: "France", descriptionClean: "Poste en full remote. Python, SQL." }), "location").evidence.join(" ")).toContain("inferred");
    expect(component(run({ title: "Développeur ETL", location: "Nancy", descriptionClean: strongDescription }), "location").score).toBeGreaterThanOrEqual(16);
  });
  it("blocks on-site roles far outside the commute range", () => {
    const result = run({ title: "Data Engineer", location: "Marseille", remoteType: "ONSITE", descriptionClean: strongDescription });
    expect(result.blockers.join(" ")).toContain("outside your commute range"); expect(result.score).toBeLessThanOrEqual(35); expect(result.label).toBe("LOW");
  });
  it("blocks internships and apprenticeships the profile does not seek", () => {
    expect(run({ title: "Stage Data Engineer (H/F)", location: "Metz", descriptionClean: strongDescription }).blockers.join(" ")).toContain("Internship");
    expect(run({ title: "Data Engineer en alternance", location: "Metz", contractType: "Alternance", descriptionClean: strongDescription }).score).toBeLessThanOrEqual(35);
  });
  it("blocks roles that require a language the profile lacks and never invents one", () => {
    const result = run({ title: "Data Engineer", location: "Luxembourg", descriptionClean: "Deutsch verhandlungssicher erforderlich. Allemand courant exigé. SQL Server, Python." });
    expect(result.blockers.join(" ")).toMatch(/german/i); expect(result.score).toBeLessThanOrEqual(35);
  });
  it("lists missing skills and transferable alternatives without crediting them", () => {
    const result = run({ title: "Développeur ETL", location: "Metz", descriptionClean: "Maîtrise de Talend et de SQL Server requise. 2 ans d'expérience. CDI." });
    expect(result.missingSkills).toContain("Talend"); expect(result.matchedSkills.map(item => item.skill)).not.toContain("Talend");
    expect(result.transferableSkills.join(" ")).toContain("SSIS");
  });
  it("ranks an irrelevant role low", () => {
    const result = run({ title: "Design System Director", location: "Berlin", descriptionClean: "Lead our design organisation. Figma, brand and typography." });
    expect(result.score).toBeLessThan(50); expect(labelFor(result.score)).toBe("LOW");
  });
  it("applies exclusions and salary floors as blockers", () => {
    const excluding = candidateProfileSchema.parse({ ...candidate, excludedKeywords: ["défense"] });
    expect(run({ title: "Data Engineer", location: "Metz", descriptionClean: "Secteur défense. SQL." }, excluding).blockers).toContain("Excluded term: défense");
    expect(run({ title: "Data Engineer", location: "Metz", salaryMin: 28_000, salaryMax: 33_000, descriptionClean: strongDescription }).blockers).toContain("Maximum stated salary is below the candidate minimum");
  });
  it("does not crash and stays honest with an empty profile", () => {
    const result = scoreJob(candidateProfileSchema.parse({}), job({ title: "Data Engineer", location: "Metz", descriptionClean: strongDescription }));
    expect(result.score).toBeGreaterThan(0); expect(result.score).toBeLessThan(80); expect(result.uncertain.length).toBeGreaterThan(0); expect(result.matchedSkills).toEqual([]);
  });
  it("recognises C++ and French/English title synonyms", () => {
    const cpp = candidateProfileSchema.parse({ ...candidate, targetRoles: ["C++ Developer"], coreSkills: ["C++"], locations: ["Nancy"] });
    expect(run({ title: "Ingénieur développement logiciel C++ (H/F)", location: "Vandœuvre-lès-Nancy", descriptionClean: "Développement en C++ moderne, CMake, Linux. 3 ans d'expérience. CDI." }, cpp).score).toBeGreaterThanOrEqual(65);
  });
  it("caps roles two or more seniority levels above the candidate's experience", () => {
    const director = run({ title: "Director of Data Engineering", location: "Metz", descriptionClean: strongDescription.replace("Au moins 3 ans d'expérience. ", "") });
    expect(director.score).toBeLessThanOrEqual(60); expect(component(director, "experience").gaps.join(" ")).toContain("seniority levels");
    expect(run({ title: "Senior Data Engineer", location: "Metz", descriptionClean: strongDescription.replace("Au moins 3 ans d'expérience. ", "") }).score).toBeGreaterThan(60);
  });
  it("is deterministic", () => {
    const input = { title: "Data Engineer", location: "Metz", descriptionClean: strongDescription };
    expect(run(input)).toEqual(run(input));
  });
});

describe("query expansion", () => {
  it("adds bilingual synonyms after the owner's own titles", () => {
    const queries = expandTitles(["Data Engineer"]); expect(queries[0]).toBe("Data Engineer"); expect(queries).toContain("Ingénieur Data");
  });
  it("stays bounded and de-duplicated", () => {
    const queries = expandTitles(["Data Engineer", "data engineer", "DevOps Engineer", "Développeur C++", "Data Analyst", "Business Analyst"], 8);
    expect(queries.length).toBeLessThanOrEqual(8); expect(new Set(queries.map(item => item.toLowerCase())).size).toBe(queries.length);
  });
});
