import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { alertToJob } from "@/providers/alerts";
import { linkedinPortal } from "@/providers/portals";
import { database, describeDb, resetDatabase, seedOwner } from "@/tests/integration/helpers";

const strong = "Compétences requises : SQL Server, SSIS, Python, Azure Data Factory. 3 ans d'expérience. CDI. Télétravail partiel possible.";
const actorItems = [
  { id: "4467735579", title: "Ingénieur Data (H/F)", companyName: "Acme Données", location: "Metz, Grand Est, France", descriptionText: strong, employmentType: "Full-time", postedAt: "2026-10-18" },
  { id: "4467735580", title: "Design System Director", companyName: "Acme Données", location: "Berlin, Germany", descriptionText: "Lead design. Figma and typography." }
];
let started: URL | null = null;
function stubApify() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const target = String(url); const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (target.includes("/acts/curious_coder~linkedin-jobs-scraper/runs?")) { started = new URL(target); return json({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.004 } }, 201); }
    if (target.includes("/datasets/ds1/items?")) return json(actorItems);
    return json({ error: { message: `unexpected ${target}` } }, 500);
  }));
}

describeDb("paid portal sources and job-alert postings", () => {
  beforeEach(async () => { await resetDatabase(); await seedOwner(); started = null; stubApify(); });
  afterEach(() => vi.unstubAllGlobals());

  it("runs the LinkedIn actor within the source's own limit and stores relevant postings with the run cost", async () => {
    const db = await database(); const { ensureProviders } = await import("@/lib/services/providers"); await ensureProviders();
    await db.providerSetting.update({ where: { id: "linkedin" }, data: { enabled: true, maxJobs: 12 } });
    const { createSearchRun, processSearchRun } = await import("@/lib/services/search");
    const run = await createSearchRun("MANUAL"); expect(await processSearchRun(run.id)).toBe("FINISHED");
    expect(started?.searchParams.get("maxItems")).toBe("12"); expect(started?.searchParams.get("maxTotalChargeUsd")).toBe("0.10");
    const jobs = await db.job.findMany({ include: { sources: true } });
    expect(jobs.map(job => job.title)).toEqual(["Ingénieur Data (H/F)"]);
    expect(jobs[0]!.sources[0]).toMatchObject({ provider: "linkedin", sourceJobId: "4467735579", sourceUrl: "https://www.linkedin.com/jobs/view/4467735579/" });
    const providerRun = await db.providerRun.findFirstOrThrow({ where: { runId: run.id } });
    expect(providerRun).toMatchObject({ providerId: "linkedin", status: "HEALTHY" }); expect(providerRun.extractorStats).toMatchObject({ costUsd: 0.004, fetched: 2 });
  });

  it("merges a job-alert posting with the scraped copy and never replaces the full description with the alert summary", async () => {
    const db = await database(); const { ingestJob } = await import("@/lib/services/jobs");
    const scraped = linkedinPortal.normalize(actorItems[0]!);
    const alert = alertToJob({ portal: "linkedin", id: "4467735579", url: "https://www.linkedin.com/jobs/view/4467735579/", title: "Ingénieur Data (H/F)", company: "Acme Données", location: "Metz", contract: "", salary: "" }, new Date("2026-10-19T10:00:00Z"));
    const first = await ingestJob(scraped); const second = await ingestJob(alert);
    expect(second).toMatchObject({ duplicate: true, materiallyChanged: false }); expect(second.job.id).toBe(first.job.id);
    expect((await db.job.findUniqueOrThrow({ where: { id: first.job.id } })).descriptionClean).toBe(strong);

    await resetDatabase(); await seedOwner();
    const fromAlert = await ingestJob(alert); const upgraded = await ingestJob(scraped);
    expect(upgraded.job.id).toBe(fromAlert.job.id); expect(upgraded.materiallyChanged).toBe(true);
    expect((await db.job.findUniqueOrThrow({ where: { id: fromAlert.job.id } })).descriptionClean).toBe(strong);
  });
});
