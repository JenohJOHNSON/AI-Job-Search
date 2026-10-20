import { afterEach, describe, expect, it, vi } from "vitest";
import { apifyClient, ApifyPortalProvider, type ApifyClient } from "@/providers/apify";
import { helloworkPortal, indeedPortal, linkedinPortal, salaryFromText, searchPairs, searchPlaces, wttjPortal, yearly } from "@/providers/portals";
import { ProviderError, type SearchRequest } from "@/providers/types";

const request: SearchRequest = { queries: ["Data Engineer", "Ingénieur Data", "Développeur ETL", "ETL Developer"], locations: ["Metz", "Nancy", "Luxembourg", "Remote France"], remotePreferences: ["remote"], datePostedWindow: 7, maxJobs: 200, paidItems: 30 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("search planning for paid portals", () => {
  it("keeps a remote place and caps the places", () => {
    expect(searchPlaces(request)).toEqual([{ label: "Metz", remote: false, country: "FR" }, { label: "Nancy", remote: false, country: "FR" }, { label: "France", remote: true, country: "FR" }]);
  });
  it("orders title × place pairs so every title and place appears early", () => {
    const pairs = searchPairs(request, 6).map(pair => `${pair.query}@${pair.place.remote ? "remote" : pair.place.label}`);
    expect(pairs).toEqual(["Data Engineer@Metz", "Data Engineer@Nancy", "Ingénieur Data@Metz", "Data Engineer@remote", "Ingénieur Data@Nancy", "Développeur ETL@Metz"]);
  });
  it("builds one LinkedIn run with public search URLs and splits the budget", () => {
    const [run] = linkedinPortal.runs(request, 30);
    const urls = run!.input.urls as string[];
    expect(urls).toHaveLength(6); expect(run!.maxItems).toBe(30); expect(run!.input.limitPerSource).toBe(5);
    expect(urls[0]).toBe("https://www.linkedin.com/jobs/search/?keywords=Data+Engineer&location=Metz&f_TPR=r604800");
    expect(urls[3]).toContain("f_WT=2");
  });
  it("searches Luxembourg on lu.indeed.com and remote as Télétravail", () => {
    const urls = indeedPortal.runs({ ...request, locations: ["Luxembourg", "Remote France"] }, 20)[0]!.input.urls as string[];
    expect(urls.some(url => url.startsWith("https://lu.indeed.com/jobs?q=Data+Engineer&l=Luxembourg"))).toBe(true);
    expect(urls.some(url => url.includes("l=T%C3%A9l%C3%A9travail"))).toBe(true);
  });
  it("skips HelloWork outside France instead of searching the wrong country", () => {
    expect(helloworkPortal.runs({ ...request, locations: ["Luxembourg"], remotePreferences: [] }, 20)).toEqual([]);
    const runs = helloworkPortal.runs(request, 30); expect(runs).toHaveLength(3); expect(runs[2]!.input).toMatchObject({ location: "", telework: ["FULL", "PARTIAL"] });
  });
});

describe("salary parsing", () => {
  it("reads French and English labels and never guesses hourly pay", () => {
    expect(salaryFromText("44 000 - 52 000 € / an")).toEqual({ salaryMin: 44_000, salaryMax: 52_000 });
    expect(salaryFromText("€45,000.00/yr - €55,000.00/yr")).toEqual({ salaryMin: 45_000, salaryMax: 55_000 });
    expect(salaryFromText("45K€ - 55K€ par an")).toEqual({ salaryMin: 45_000, salaryMax: 55_000 });
    expect(salaryFromText("3 200 € par mois")).toEqual({ salaryMin: 38_400, salaryMax: null });
    expect(salaryFromText("17,06 € / heure")).toEqual({ salaryMin: null, salaryMax: null });
    expect(yearly(3000, 3500, "MONTHLY")).toEqual({ salaryMin: 36_000, salaryMax: 42_000 });
  });
});

describe("portal record normalization", () => {
  it("normalizes a LinkedIn actor record to a canonical posting URL", () => {
    const job = linkedinPortal.normalize({ id: "4467735579", title: "Data Engineer", companyName: "Acme Data", location: "Nancy, Grand Est, France (Hybrid)", link: "https://fr.linkedin.com/jobs/view/data-engineer-at-acme-4467735579?trk=x", descriptionHtml: "<p>SQL Server, SSIS et Python.</p>", employmentType: "Full-time", postedAt: "2026-10-18", salary: "€45,000.00/yr - €55,000.00/yr", companyWebsite: "https://www.acme.example" });
    expect(job).toMatchObject({ source: "linkedin", sourceJobId: "4467735579", sourceUrl: "https://www.linkedin.com/jobs/view/4467735579/", companyName: "Acme Data", remoteType: "HYBRID", contractType: "Full-time", salaryMin: 45_000, salaryMax: 55_000, descriptionClean: expect.stringContaining("SQL Server"), companyDomain: "acme.example", publishedAt: "2026-10-18T00:00:00.000Z" });
  });
  it("normalizes an Indeed record with yearly salary and lower-case job key", () => {
    const job = indeedPortal.normalize({ jobKey: "A1B2C3D4E5F6A7B8", title: "Ingénieur Data", companyName: "Beta", jobUrl: "https://fr.indeed.com/viewjob?jk=a1b2c3d4e5f6a7b8", location: { city: "Metz", formattedAddressShort: "Metz (57)", countryCode: "FR" }, salary: { salaryMin: 3000, salaryMax: 3500, salaryType: "MONTHLY", salaryCurrency: "EUR" }, jobType: ["CDI"], isRemote: false, descriptionText: "ETL et SQL.", datePublished: "2026-10-17T08:00:00Z" });
    expect(job).toMatchObject({ source: "indeed", sourceJobId: "a1b2c3d4e5f6a7b8", sourceUrl: "https://fr.indeed.com/viewjob?jk=a1b2c3d4e5f6a7b8", location: "Metz (57)", salaryMin: 36_000, salaryMax: 42_000, contractType: "CDI" });
  });
  it("normalizes a Welcome to the Jungle record with contract, remote policy and skills", () => {
    const job = wttjPortal.normalize({ id: "x1", name: "Data Engineer", organizationName: "Gamma", url: "https://www.welcometothejungle.com/en/companies/gamma/jobs/data-engineer_nancy?q=1", offices: [{ city: "Nancy", country_code: "FR" }], contractType: "full_time", remote: "partial", salaryMin: 45000, salaryMax: 52000, salaryPeriod: "yearly", description: "<p>Pipelines Azure</p>", profile: "3 ans en ETL", skills: [{ name: { fr: "SQL", en: "SQL" } }], experienceLevel: 3, publishedAt: "2026-10-16T10:00:00Z" });
    expect(job).toMatchObject({ source: "wttj", sourceJobId: "gamma/data-engineer_nancy", sourceUrl: "https://www.welcometothejungle.com/fr/companies/gamma/jobs/data-engineer_nancy", contractType: "CDI", remoteType: "HYBRID", salaryMin: 45_000, skillsRequired: ["SQL"], experienceMin: 3 });
    expect(job.descriptionClean).toContain("Profil recherché");
  });
  it("normalizes a HelloWork record", () => {
    const job = helloworkPortal.normalize({ jobId: "83681071", title: "Analyste de données H/F", company: "Delta", location: "Metz - 57", jobUrl: "https://www.hellowork.com/fr-fr/emplois/83681071.html", contractType: "CDI", telework: "PARTIAL", salary: "44 000 - 52 000 € / an", descriptionText: "Power BI et SQL.", datePosted: "2026-10-15" });
    expect(job).toMatchObject({ source: "hellowork", sourceUrl: "https://www.hellowork.com/fr-fr/emplois/83681071.html", remoteType: "HYBRID", salaryMin: 44_000, salaryMax: 52_000 });
  });
});

describe("Apify-backed portal provider", () => {
  const item = (id: number) => ({ id: String(4_000_000_000 + id), title: `Data Engineer ${id}`, companyName: "Acme", location: "Metz", descriptionText: "SQL" });
  it("caps every run in items and dollars, keeps partial failures, de-duplicates and reports cost", async () => {
    const run = vi.fn<ApifyClient["run"]>(async () => ({ items: [item(1), item(2), item(1), { title: "no id" }], status: "SUCCEEDED", costUsd: 0.012 }));
    const provider = new ApifyPortalProvider(linkedinPortal, { run, account: vi.fn(), actor: vi.fn() });
    const result = await provider.search(request);
    expect(run).toHaveBeenCalledWith("curious_coder/linkedin-jobs-scraper", expect.objectContaining({ limitPerSource: 5 }), { maxItems: 30, maxChargeUsd: 0.17 });
    expect(result.jobs).toHaveLength(2); expect(result.stats).toEqual({ fetched: 4, valid: 2, invalid: 1, costUsd: 0.012 });
  });
  it("reports one failed search as a warning but fails when every search fails", async () => {
    let call = 0;
    const run = vi.fn<ApifyClient["run"]>(async () => { if (call++ === 0) throw new ProviderError("BLOCKED", "Apify refused the request: not enough credit", false); return { items: [{ ...item(3), url: "https://www.welcometothejungle.com/fr/companies/acme/jobs/de_metz", name: "DE", organizationName: "Acme" }], status: "SUCCEEDED", costUsd: 0 }; });
    const partial = await new ApifyPortalProvider(wttjPortal, { run, account: vi.fn(), actor: vi.fn() }).search(request);
    expect(partial.jobs).toHaveLength(1); expect(partial.warnings[0]).toContain("not enough credit");
    const failing = vi.fn<ApifyClient["run"]>(async () => { throw new ProviderError("AUTH", "Apify rejected the API token", false); });
    await expect(new ApifyPortalProvider(wttjPortal, { run: failing, account: vi.fn(), actor: vi.fn() }).search(request)).rejects.toMatchObject({ code: "AUTH" });
  });
  it("checks the token and actor without starting a billed run", async () => {
    const run = vi.fn();
    const health = await new ApifyPortalProvider(indeedPortal, { run, account: async () => ({ username: "jenoh", plan: "FREE" }), actor: async () => ({ title: "Indeed jobs scraper" }) }).healthCheck();
    expect(health.status).toBe("HEALTHY"); expect(health.detail).toContain("jenoh (FREE plan)"); expect(run).not.toHaveBeenCalled();
  });
});

describe("Apify API client", () => {
  it("starts the actor with cost limits, polls until finished and reads the dataset", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/acts/curious_coder~linkedin-jobs-scraper/runs?")) return json({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }, 201);
      if (url.includes("/actor-runs/run1?")) return json({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.021 } });
      if (url.includes("/datasets/ds1/items?")) return json([{ id: "1" }, { id: "2" }]);
      return json({ error: { message: "unexpected" } }, 500);
    }));
    const result = await apifyClient.run("curious_coder/linkedin-jobs-scraper", { keywords: "x" }, { maxItems: 25, maxChargeUsd: 0.15 });
    expect(result).toEqual({ items: [{ id: "1" }, { id: "2" }], status: "SUCCEEDED", costUsd: 0.021 });
    const start = new URL(calls[0]!.url);
    expect(start.searchParams.get("maxItems")).toBe("25"); expect(start.searchParams.get("maxTotalChargeUsd")).toBe("0.15");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer test-apify-token");
  });
  it("aborts a run that outlives its deadline and keeps what it collected", async () => {
    const aborted = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/runs?")) return json({ data: { id: "run2", status: "RUNNING", defaultDatasetId: "ds2" } }, 201);
      if (url.includes("/actor-runs/run2/abort")) { aborted(); return json({ data: { id: "run2", status: "ABORTING" } }); }
      if (url.includes("/actor-runs/run2?")) return json({ data: { id: "run2", status: "RUNNING", defaultDatasetId: "ds2" } });
      return json([{ id: "partial" }]);
    }));
    const result = await apifyClient.run("borderline/indeed-scraper", {}, { maxItems: 10, maxChargeUsd: 0.1, deadlineMs: 0 });
    expect(aborted).toHaveBeenCalledOnce(); expect(result).toMatchObject({ status: "ABORTED", items: [{ id: "partial" }] });
  });
  it("turns Apify's refusals into actionable provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { type: "not-enough-usage-to-run-paid-actor", message: "Insufficient credit" } }, 402)));
    await expect(apifyClient.account()).rejects.toMatchObject({ code: "BLOCKED", message: "Apify refused the request: Insufficient credit" });
  });
});
