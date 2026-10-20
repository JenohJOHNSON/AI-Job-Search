import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { database, describeDb, resetDatabase, seedOwner } from "@/tests/integration/helpers";

const posting = (id: number, title: string, location: string, content: string) => ({ id, title, absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`, location: { name: location }, content, first_published: "2026-10-10T08:00:00Z" });
const strong = "Compétences requises : SQL Server, SSIS, Python, Azure Data Factory. 3 ans d'expérience. CDI. Télétravail partiel possible.";
let board: ReturnType<typeof posting>[] = [];
function stubGreenhouse() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const target = String(url);
    if (target.includes("/boards/broken")) return new Response("", { status: 404 });
    if (target.includes("/jobs?content=true")) return new Response(JSON.stringify({ jobs: board }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ name: "Acme Données" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}
async function enableGreenhouse(boards: string[]) {
  const db = await database(); const { ensureProviders } = await import("@/lib/services/providers"); await ensureProviders();
  await db.providerSetting.update({ where: { id: "greenhouse" }, data: { enabled: true, rateLimitMs: 100, config: { boards } } });
}
async function runOnce() {
  const { createSearchRun, processSearchRun } = await import("@/lib/services/search"); const db = await database();
  const run = await createSearchRun("MANUAL"); const status = await processSearchRun(run.id); return { status, run: await db.searchRun.findUniqueOrThrow({ where: { id: run.id }, include: { providerRuns: true } }) };
}

describeDb("search run pipeline", () => {
  beforeEach(async () => {
    await resetDatabase(); await seedOwner();
    board = [
      posting(1, "Ingénieur Data (H/F)", "Metz", strong),
      posting(2, "Stage Data Engineer (H/F)", "Metz", strong),
      posting(3, "Design System Director", "Berlin, Germany", "Lead design. Figma and typography."),
      posting(4, "Data Engineer", "Marseille", `${strong} Présence sur site obligatoire, pas de télétravail.`),
      posting(5, "Azure Data Engineer", "Remote - France", "Full remote. Azure Data Factory, SQL Server, Python. CDI.")
    ];
    stubGreenhouse();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stores only relevant, unblocked jobs with explainable scores and real company names", async () => {
    await enableGreenhouse(["acme"]); const { status, run } = await runOnce(); const db = await database();
    expect(status).toBe("FINISHED"); expect(run).toMatchObject({ status: "FINISHED", providersAttempted: 1, providersSuccessful: 1, jobsDiscovered: 5, jobsNew: 2 });
    const jobs = await db.job.findMany({ orderBy: { rankScore: "desc" } }); expect(jobs.map(job => job.title)).toEqual(["Ingénieur Data (H/F)", "Azure Data Engineer"]);
    expect(jobs[0]).toMatchObject({ companyName: "Acme Données", status: "ACTIVE" }); expect(jobs[0]!.rankScore).toBeGreaterThanOrEqual(75);
    const details = jobs[0]!.matchDetails as { blockers: string[]; matchedSkills: { skill: string }[]; components: unknown[] }; expect(details.blockers).toEqual([]); expect(details.matchedSkills.map(item => item.skill)).toContain("SSIS");
    expect(run.providerRuns[0]).toMatchObject({ status: "HEALTHY", jobsDiscovered: 5 });
  });
  it("is idempotent: a second run adds no duplicates and a processed run is not executed twice", async () => {
    await enableGreenhouse(["acme"]); const first = await runOnce(); const second = await runOnce(); const db = await database();
    expect(second.run).toMatchObject({ jobsNew: 0, jobsDuplicate: 2 }); expect(await db.job.count()).toBe(2); expect(await db.jobPostingSource.count()).toBe(2);
    const { processSearchRun } = await import("@/lib/services/search"); expect(await processSearchRun(first.run.id)).toBe("SKIPPED");
  });
  it("isolates a failing board: the run still finishes and the failure is diagnosable", async () => {
    await enableGreenhouse(["broken", "acme"]); const { run } = await runOnce();
    expect(run.status).toBe("FINISHED"); expect(run.jobsNew).toBe(2); expect(run.providerRuns[0]!.status).toBe("DEGRADED"); expect(run.providerRuns[0]!.errorMessage).toMatch(/broken.*404/);
  });
  it("fails clearly (without retry loops) when nothing is configured", async () => {
    const { status, run } = await runOnce(); expect(status).toBe("FAILED"); expect(JSON.stringify(run.errors)).toContain("No job source is enabled");
  });
  it("fails clearly when the candidate has no search profile", async () => {
    const db = await database(); await db.searchProfile.deleteMany({}); await enableGreenhouse(["acme"]); const { run } = await runOnce();
    expect(run.status).toBe("FAILED"); expect(JSON.stringify(run.errors)).toContain("search profile");
  });
  it("marks vacancies removed when they leave a fully fetched board, and reactivates them if they return", async () => {
    await enableGreenhouse(["acme"]); await runOnce(); const db = await database();
    const gone = board.pop()!; const { run } = await runOnce();
    expect((await db.job.findFirstOrThrow({ where: { title: "Azure Data Engineer" } })).status).toBe("REMOVED"); expect((run.providerRuns[0]!.extractorStats as { removed: number }).removed).toBe(1);
    expect((await db.job.findFirstOrThrow({ where: { title: "Ingénieur Data (H/F)" } })).status).toBe("ACTIVE");
    board.push(gone); await runOnce(); expect((await db.job.findFirstOrThrow({ where: { title: "Azure Data Engineer" } })).status).toBe("ACTIVE");
  });
  it("treats an empty listing as a glitch instead of closing every vacancy", async () => {
    await enableGreenhouse(["acme"]); await runOnce(); const db = await database(); board = [];
    const { run } = await runOnce(); expect(await db.job.count({ where: { status: "ACTIVE" } })).toBe(2); expect(run.providerRuns[0]!.errorMessage).toContain("temporary glitch");
  });
  it("re-scores stored jobs when the profile changes", async () => {
    await enableGreenhouse(["acme"]); await runOnce(); const db = await database(); const { rescoreJobs } = await import("@/lib/services/matching");
    const before = (await db.job.findFirstOrThrow({ where: { title: "Ingénieur Data (H/F)" } })).rankScore!;
    const profile = await db.candidateProfile.findFirstOrThrow(); await db.candidateProfile.update({ where: { id: profile.id }, data: { version: { increment: 1 }, data: { ...(profile.data as object), excludedKeywords: ["SSIS"] } } });
    expect((await rescoreJobs()).rescored).toBe(2); const after = await db.job.findFirstOrThrow({ where: { title: "Ingénieur Data (H/F)" } });
    expect(after.rankScore!).toBeLessThanOrEqual(35); expect(after.rankScore!).toBeLessThan(before); expect(after.matchProfileVersion).toBe(2);
  });
});

describeDb("cross-source deduplication", () => {
  beforeEach(resetDatabase);
  it("merges the same vacancy from two sources but not unrelated postings with empty descriptions", async () => {
    const { ingestJob } = await import("@/lib/services/jobs"); const { job } = await import("@/tests/fixtures/candidate"); const db = await database();
    const long = `${"Concevoir des pipelines de données fiables avec SSIS et Python pour nos équipes. ".repeat(6)}`;
    const a = await ingestJob(job({ source: "greenhouse", sourceJobId: "1", sourceUrl: "https://a.example.test/1", title: "Data Engineer", location: "Metz", descriptionClean: long }));
    const b = await ingestJob(job({ source: "france_travail", sourceJobId: "FT1", sourceUrl: "https://ft.example.test/1", title: "Data Engineer (H/F)", location: "Metz (57)", descriptionClean: long }));
    expect(b.duplicate).toBe(true); expect(b.job.id).toBe(a.job.id); expect(await db.jobPostingSource.count({ where: { jobId: a.job.id } })).toBe(2);
    const c = await ingestJob(job({ source: "lever", sourceJobId: "9", sourceUrl: "https://a.example.test/9", title: "Office Manager", location: "Paris", descriptionClean: "" }));
    const d = await ingestJob(job({ source: "lever", sourceJobId: "10", sourceUrl: "https://a.example.test/10", title: "Chef de projet", location: "Lyon", descriptionClean: "" }));
    expect(c.job.id).not.toBe(d.job.id);
  });
  it("keeps the same role in different cities apart and prefers the employer's own application link", async () => {
    const { ingestJob } = await import("@/lib/services/jobs"); const { job } = await import("@/tests/fixtures/candidate");
    const metz = await ingestJob(job({ source: "france_travail", sourceJobId: "F1", sourceUrl: "https://ft.example.test/f1", applicationUrl: "https://ft.example.test/f1", title: "Data Engineer", location: "Metz", descriptionClean: "x".repeat(300) }));
    const paris = await ingestJob(job({ source: "lever", sourceJobId: "L1", sourceUrl: "https://lever.example.test/l1", title: "Data Engineer", location: "Paris", descriptionClean: "x".repeat(300) }));
    expect(paris.job.id).not.toBe(metz.job.id);
    const employer = await ingestJob(job({ source: "greenhouse", sourceJobId: "G1", sourceUrl: "https://gh.example.test/g1", applicationUrl: "https://gh.example.test/apply/g1", title: "Data Engineer", location: "Metz", descriptionClean: "x".repeat(300) }));
    expect(employer.job.id).toBe(metz.job.id); expect(employer.job.applicationUrl).toBe("https://gh.example.test/apply/g1");
  });
});
