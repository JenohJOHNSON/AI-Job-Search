import { afterEach, describe, expect, it, vi } from "vitest";
import { AshbyProvider } from "@/providers/ashby";
import { cleanText, fixedFetch } from "@/providers/core";
import { FranceTravailProvider, geoGroups, parseSalary } from "@/providers/france-travail";
import { GreenhouseProvider } from "@/providers/greenhouse";
import { LeverProvider } from "@/providers/lever";
import { ProviderError } from "@/providers/types";

const request = { queries: ["Data Engineer"], locations: ["Metz", "Nancy"], remotePreferences: [], datePostedWindow: 7, maxJobs: 500 };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("text cleaning", () => {
  it("unescapes the entity-encoded HTML that Greenhouse returns and keeps list structure", () => {
    expect(cleanText("&lt;p&gt;Vos missions&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Concevoir des pipelines&lt;/li&gt;&lt;li&gt;Maintenir SQL Server&lt;/li&gt;&lt;/ul&gt;")).toBe("Vos missions\n- Concevoir des pipelines\n- Maintenir SQL Server");
  });
  it("strips scripts and decodes entities in ordinary HTML", () => {
    expect(cleanText("<p>Caf&eacute; &amp; data<script>alert(1)</script></p>")).toBe("Café & data");
  });
});

describe("bounded retries", () => {
  it("retries transient 5xx responses a limited number of times, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await (await fixedFetch("https://example.test/a", undefined, { baseDelayMs: 1 })).json()).toEqual({ ok: true }); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("gives up after the retry budget and never retries 404 or auth failures", async () => {
    const failing = vi.fn().mockResolvedValue(new Response("", { status: 500 })); vi.stubGlobal("fetch", failing);
    await expect(fixedFetch("https://example.test/a", undefined, { retries: 1, baseDelayMs: 1 })).rejects.toMatchObject({ code: "NETWORK" }); expect(failing).toHaveBeenCalledTimes(2);
    const missing = vi.fn().mockResolvedValue(new Response("", { status: 404 })); vi.stubGlobal("fetch", missing);
    await expect(fixedFetch("https://example.test/a", undefined, { baseDelayMs: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(missing).toHaveBeenCalledTimes(1);
    const denied = vi.fn().mockResolvedValue(new Response("", { status: 403 })); vi.stubGlobal("fetch", denied);
    await expect(fixedFetch("https://example.test/a")).rejects.toBeInstanceOf(ProviderError); expect(denied).toHaveBeenCalledTimes(1);
  });
});

describe("ATS board adapters", () => {
  it("Greenhouse returns the whole board with the real company name, readable text and complete coverage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/jobs?content=true")
      ? json({ jobs: [{ id: 1, title: "Ingénieur Data", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", location: { name: "Metz" }, content: "&lt;p&gt;SQL Server&lt;/p&gt;", first_published: "2026-10-01T08:00:00Z", updated_at: "2026-10-10T08:00:00Z" }, { id: 2, title: "Office Manager", absolute_url: "https://boards.greenhouse.io/acme/jobs/2", location: { name: "Paris" }, content: "" }] })
      : json({ name: "Acme Données" })));
    const result = await new GreenhouseProvider({ boards: ["acme"] }).search(request);
    expect(result.jobs.map(job => job.title)).toEqual(["Ingénieur Data", "Office Manager"]); expect(result.jobs[0]!.companyName).toBe("Acme Données");
    expect(result.jobs[0]!.descriptionClean).toBe("SQL Server"); expect(result.jobs[0]!.publishedAt).toBe("2026-10-01T08:00:00.000Z");
    expect(result.coverage).toEqual([{ scope: "greenhouse:acme", sourceJobIds: ["1", "2"] }]); expect(result.jobs.every(job => job.scope === "greenhouse:acme")).toBe(true);
  });
  it("Lever keeps requirement lists, parses salary, and falls back to the European API origin", async () => {
    const posting = { id: "p1", text: "Data Engineer", hostedUrl: "https://jobs.lever.co/acme/p1", applyUrl: "https://jobs.lever.co/acme/p1/apply", createdAt: 1_760_000_000_000, descriptionPlain: "Rejoignez l'équipe.", lists: [{ text: "Profil", content: "<li>SSIS</li><li>Python</li>" }], categories: { location: "Nancy", allLocations: ["Nancy", "Luxembourg"], commitment: "CDI" }, workplaceType: "hybrid", salaryRange: { min: 42000, max: 52000, currency: "EUR", interval: "per-year-salary" } };
    const calls: string[] = []; vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); return String(url).startsWith("https://api.eu.lever.co") ? json([posting]) : new Response("", { status: 404 }); }));
    const [job] = (await new LeverProvider({ boards: ["acme"] }).search(request)).jobs;
    expect(calls[0]).toContain("api.lever.co"); expect(calls[1]).toContain("api.eu.lever.co");
    expect(job!.descriptionClean).toContain("- SSIS"); expect(job!.location).toBe("Nancy; Luxembourg"); expect(job!.remoteType).toBe("HYBRID"); expect([job!.salaryMin, job!.salaryMax]).toEqual([42000, 52000]);
  });
  it("Ashby reads compensation and unlisted postings are skipped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ jobs: [{ id: "a", title: "Analytics Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/a", location: "Paris", workplaceType: "Remote", employmentType: "FullTime", descriptionPlain: "dbt", compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "EUR", minValue: 60000, maxValue: 80000 }] } }, { id: "b", title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/b", isListed: false }] })));
    const result = await new AshbyProvider({ boards: ["acme"] }).search(request);
    expect(result.jobs).toHaveLength(1); expect(result.jobs[0]).toMatchObject({ remoteType: "REMOTE", salaryMin: 60000, salaryMax: 80000 }); expect(result.coverage![0]!.sourceJobIds).toEqual(["a"]);
  });
  it("isolates a failing board: the others still return jobs and the failure becomes a warning", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("missing") ? new Response("", { status: 404 }) : json({ jobs: [{ id: "a", title: "Data Engineer", jobUrl: "https://jobs.ashbyhq.com/ok/a", location: "Paris", descriptionPlain: "x" }] })));
    const result = await new AshbyProvider({ boards: ["missing", "ok"] }).search(request);
    expect(result.jobs).toHaveLength(1); expect(result.warnings.join(" ")).toContain("missing"); expect(result.coverage!.map(item => item.scope)).toEqual(["ashby:ok"]);
  });
  it("reports connectivity per board", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("bad") ? new Response("", { status: 404 }) : json({ jobs: [{ id: "a", title: "T", jobUrl: "https://jobs.ashbyhq.com/ok/a" }] })));
    const health = await new AshbyProvider({ boards: ["ok", "bad"] }).healthCheck(); expect(health.status).toBe("DEGRADED"); expect(health.detail).toContain("ok: 1 openings");
    expect((await new AshbyProvider({}).healthCheck()).status).toBe("DEGRADED");
  });
});

describe("France Travail adapter", () => {
  const offer = (id: string, extra: Record<string, unknown> = {}) => ({ id, intitule: "Ingénieur Data (H/F)", description: "Python, SQL Server", dateCreation: "2026-10-15T07:00:00.000Z", lieuTravail: { libelle: "57 - METZ", codePostal: "57000" }, entreprise: { nom: "Exemple SA" }, typeContrat: "CDI", experienceLibelle: "3 Ans", salaire: { libelle: "Annuel de 38000.0 Euros à 45000.0 Euros sur 12.0 mois" }, origineOffre: { urlOrigine: "https://partner.example.test/o/1" }, contact: { urlPostulation: "https://careers.example.test/apply/1" }, ...extra });
  it("normalises an offer, preferring the employer's application URL while keeping a stable identity URL", () => {
    const job = new FranceTravailProvider().normalize(offer("123ABC"));
    expect(job).toMatchObject({ sourceJobId: "123ABC", sourceUrl: "https://candidat.francetravail.fr/offres/recherche/detail/123ABC", applicationUrl: "https://careers.example.test/apply/1", location: "METZ (57)", contractType: "CDI", salaryMin: 38000, salaryMax: 45000, experienceMin: 3 });
  });
  it("parses salary labels without inventing hourly pay", () => {
    expect(parseSalary("Mensuel de 3000 Euros sur 12 mois")).toEqual({ min: 36000, max: 36000 }); expect(parseSalary("Horaire de 12.5 Euros")).toEqual({ min: null, max: null }); expect(parseSalary(undefined)).toEqual({ min: null, max: null });
  });
  it("maps Nancy, Metz and Grand Est to département filters and notes Luxembourg coverage", () => {
    expect(geoGroups(["Metz", "Nancy"], false)).toEqual([{ departments: ["57", "54"] }]);
    expect(geoGroups(["Metz", "Remote France"], true).map(group => group.departments)).toEqual([["57"], null]);
    expect(geoGroups(["Grand Est"], false)[0]!.departments).toContain("54");
    expect(geoGroups(["Luxembourg"], false)[0]!.note).toContain("France only");
  });
  it("authenticates, pages through 206 responses, de-duplicates, and treats 204 as an empty result", async () => {
    const firstPage = Array.from({ length: 150 }, (_, index) => offer(`P${index}`)); const secondPage = [offer("P149"), offer("Q1")];
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      if (String(url).includes("access_token")) { expect(String(init?.body)).toContain("client_id=test-client"); return json({ access_token: "tok", expires_in: 1500 }); }
      const params = new URL(String(url)).searchParams;
      if (params.get("motsCles") !== "Data Engineer") return new Response(null, { status: 204 });
      return params.get("range")!.startsWith("0-") ? json({ resultats: firstPage }, 206, { "content-range": "offres 0-149/152" }) : json({ resultats: secondPage }, 200);
    }));
    const result = await new FranceTravailProvider().search({ ...request, queries: ["Data Engineer", "No Such Job"] });
    expect(result.jobs).toHaveLength(151); expect(result.warnings).toEqual([]);
    const searches = urls.filter(url => url.includes("/offres/search")); expect(searches.every(url => new URL(url).searchParams.get("departement") === "57,54")).toBe(true);
    expect(searches.some(url => new URL(url).searchParams.get("publieeDepuis") === "7")).toBe(true);
  });
  it("fails clearly, without calling the API, when credentials are rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(new FranceTravailProvider().search(request)).rejects.toMatchObject({ code: "AUTH" });
    expect((await new FranceTravailProvider().healthCheck()).status).toBe("FAILED");
  });
  it("verify() reports withdrawn offers (204/404) as gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("access_token") ? json({ access_token: "tok" }) : String(url).endsWith("/LIVE") ? json(offer("LIVE")) : new Response(null, { status: 204 })));
    expect(await new FranceTravailProvider().verify!(["LIVE", "GONE1"])).toEqual({ LIVE: "ACTIVE", GONE1: "GONE" });
  });
});
