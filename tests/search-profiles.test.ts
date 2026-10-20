import { describe, expect, it } from "vitest";
import { searchProfileInputSchema } from "@/lib/schemas";
import { planSources, searchRequestFor } from "@/lib/services/search";
import { scoreJob, selectedWorkStyles, workStyleOf } from "@/matching/score";
import { candidate, job, searchProfile, strongDescription } from "@/tests/fixtures/candidate";

const profile = (overrides: Record<string, unknown>) => searchProfileInputSchema.parse({ ...searchProfile, ...overrides });

describe("source selection", () => {
  const all = profile({ name: "All sources", providers: [], targetTitles: ["Data Engineer"], locations: ["Metz"] });
  const portals = profile({ name: "Portals", providers: ["linkedin", "indeed"], targetTitles: ["DevOps Engineer"], locations: ["Luxembourg"], remotePreferences: ["remote"] });
  it("searches every enabled source for a profile that selects all of them", () => {
    const { plan } = planSources([all], ["greenhouse", "linkedin", "wttj"]);
    expect(plan.map(entry => entry.id)).toEqual(["greenhouse", "linkedin", "wttj"]);
  });
  it("searches exactly the selected sources, and an all-sources profile is not narrowed by another profile's choice", () => {
    const { plan } = planSources([all, portals], ["greenhouse", "indeed", "linkedin"]);
    expect(plan.map(entry => [entry.id, entry.profiles.map(item => item.name)])).toEqual([["greenhouse", ["All sources"]], ["indeed", ["All sources", "Portals"]], ["linkedin", ["All sources", "Portals"]]]);
    expect(planSources([portals], ["greenhouse", "indeed", "linkedin"]).plan.map(entry => entry.id)).toEqual(["indeed", "linkedin"]);
  });
  it("never searches a disabled source and names profiles left without any enabled source", () => {
    const result = planSources([portals], ["greenhouse"]);
    expect(result.plan).toEqual([]); expect(result.unserved).toEqual(["Portals"]);
  });
  it("builds each source's request from the profiles that use it", () => {
    const request = searchRequestFor([portals], candidate);
    expect(request.queries).toContain("DevOps Engineer"); expect(request.queries).not.toContain("Data Engineer");
    expect(request.locations).toEqual(expect.arrayContaining(["Luxembourg", ...candidate.locations])); expect(request.remotePreferences).toEqual(["remote"]);
    const merged = searchRequestFor([all, portals], candidate); expect(merged.queries).toEqual(expect.arrayContaining(["Data Engineer", "DevOps Engineer"]));
  });
});

describe("work styles", () => {
  const onsite = { title: "Ingénieur Data (H/F)", location: "Metz", contractType: "CDI", descriptionClean: strongDescription, remoteType: "ONSITE" };
  it("reads the stored values in any spelling", () => {
    expect(["remote", "REMOTE", "Télétravail", "hybrid", "Hybride", "onsite", "On-site", "sur site"].map(workStyleOf)).toEqual(["REMOTE", "REMOTE", "REMOTE", "HYBRID", "HYBRID", "ONSITE", "ONSITE", "ONSITE"]);
  });
  it("accepts every style when a profile has no choice or selects all three", () => {
    expect(selectedWorkStyles([profile({ remotePreferences: [] })])).toBeNull(); expect(selectedWorkStyles([profile({ remotePreferences: ["remote", "hybrid", "onsite"] })])).toBeNull();
    expect(selectedWorkStyles([profile({ remotePreferences: ["remote"] }), profile({ remotePreferences: [] })])).toBeNull();
    expect([...selectedWorkStyles([profile({ remotePreferences: ["remote"] }), profile({ remotePreferences: ["hybrid"] })])!].sort()).toEqual(["HYBRID", "REMOTE"]);
  });
  it("blocks a posting whose stated work style was not selected", () => {
    const blocked = scoreJob(candidate, job(onsite), [profile({ remotePreferences: ["remote", "hybrid"] })]);
    expect(blocked.blockers.join(" ")).toContain("On-site work is not among your selected work styles"); expect(blocked.score).toBeLessThanOrEqual(35);
    const allowed = scoreJob(candidate, job(onsite), [profile({ remotePreferences: ["onsite"] })]);
    expect(allowed.blockers).toEqual([]); expect(allowed.components.find(item => item.key === "location")!.evidence.join(" ")).toContain("matches the work styles you selected");
  });
  it("only lowers the score when the style is inferred from the text, and keeps postings that do not say", () => {
    const base = scoreJob(candidate, job({ ...onsite, remoteType: "UNKNOWN" }), [profile({ remotePreferences: ["hybrid"] })]);
    const inferred = scoreJob(candidate, job({ ...onsite, remoteType: "UNKNOWN" }), [profile({ remotePreferences: ["remote"] })]);
    expect(inferred.blockers).toEqual([]); expect(inferred.score).toBeLessThan(base.score); // the description says "télétravail partiel", i.e. hybrid
    const unstated = scoreJob(candidate, job({ ...onsite, remoteType: "UNKNOWN", descriptionClean: "Compétences requises : SQL Server, SSIS, Python. CDI." }), [profile({ remotePreferences: ["remote"] })]);
    expect(unstated.blockers).toEqual([]);
  });
});
