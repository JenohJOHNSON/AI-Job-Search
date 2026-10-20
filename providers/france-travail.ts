import { config } from "@/lib/config";
import { normalizedJobSchema, type NormalizedJob } from "@/lib/schemas";
import { areaDepartments, placeDepartments } from "@/matching/knowledge";
import { areasIn, fold, resolvePlace } from "@/matching/score";
import { fixedFetch, sleep } from "@/providers/core";
import { ProviderError, type JobProvider, type ProviderHealth, type ProviderSearchResult, type SearchRequest } from "@/providers/types";

type FtOffer = {
  id: string; intitule: string; description?: string; dateCreation?: string; dateActualisation?: string; alternance?: boolean;
  lieuTravail?: { libelle?: string; codePostal?: string; commune?: string }; entreprise?: { nom?: string };
  typeContrat?: string; typeContratLibelle?: string; natureContrat?: string; experienceLibelle?: string; experienceExige?: string;
  origineOffre?: { urlOrigine?: string }; contact?: { urlPostulation?: string }; salaire?: { libelle?: string; complement1?: string };
  competences?: { libelle?: string }[]; qualitesProfessionnelles?: { libelle?: string }[]; langues?: { libelle?: string; exigence?: string }[]; secteurActiviteLibelle?: string;
};
const tokenUrls = ["https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire", "https://entreprise.pole-emploi.fr/connexion/oauth2/access_token?realm=%2Fpartenaire"];
const apiBase = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres";
const pageSize = 150;
const detailUrl = (id: string) => `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(id)}`;
const contractNames: Record<string, string> = { CDI: "CDI", CDD: "CDD", MIS: "Intérim", SAI: "Saisonnier", LIB: "Libéral", FRA: "Franchise", DIN: "CDI intérimaire", DDI: "CDD insertion", TTI: "Travail temporaire insertion" };
const validUrl = (...values: (string | undefined)[]) => values.find(value => { try { return value ? ["https:", "http:"].includes(new URL(value).protocol) : false; } catch { return false; } });

/** Parses the free-text salary label ("Annuel de 32000.0 Euros à 38000.0 Euros sur 12.0 mois") into yearly bounds. Hourly or unparseable labels yield null. */
export function parseSalary(label?: string): { min: number | null; max: number | null } {
  if (!label) return { min: null, max: null };
  const numbers = [...label.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)\s*(?:euros?|€)/gi)].map(match => Number(match[1]!.replace(/\s/g, "").replace(",", "."))).filter(Number.isFinite);
  if (!numbers.length) return { min: null, max: null };
  const lower = fold(label); const months = Number(lower.match(/sur\s*(\d{1,2})(?:[.,]\d+)?\s*mois/)?.[1]) || 12;
  const factor = lower.startsWith("annuel") ? 1 : lower.startsWith("mensuel") ? months : 0;
  if (!factor) return { min: null, max: null };
  const scaled = numbers.map(value => Math.round(value * factor));
  return { min: Math.min(...scaled), max: Math.max(...scaled) };
}
const minExperience = (offer: FtOffer) => {
  if (offer.experienceExige === "D") return 0;
  const years = offer.experienceLibelle?.match(/(\d{1,2})\s*an/i)?.[1]; if (years) return Number(years);
  const months = offer.experienceLibelle?.match(/(\d{1,2})\s*mois/i)?.[1]; return months ? Math.floor(Number(months) / 12) : null;
};

/** Translates preferred locations into France Travail département filters. */
export function geoGroups(locations: string[], remotePreferred: boolean): { departments: string[] | null; note?: string }[] {
  const departments = new Set<string>(); let abroad = false;
  for (const location of locations) {
    const folded = fold(location); const place = resolvePlace(folded);
    if (place?.country === "FR") { const department = placeDepartments[place.name] ?? areaDepartments[place.area]?.[0]; if (department) departments.add(department); }
    else if (place) abroad = true;
    for (const area of areasIn(folded)) for (const department of areaDepartments[area] ?? []) departments.add(department);
  }
  const groups: { departments: string[] | null; note?: string }[] = [];
  const list = [...departments]; for (let index = 0; index < list.length; index += 5) groups.push({ departments: list.slice(index, index + 5) });
  if (remotePreferred || !groups.length) groups.push({ departments: null, note: abroad && !groups.length ? "Only locations outside France were requested; France Travail covers France only, so a nationwide search was used." : undefined });
  return groups;
}

export class FranceTravailProvider implements JobProvider {
  id = "france_travail"; private token?: { value: string; expires: number };
  private async accessToken() {
    const env = config();
    if (!env.FRANCE_TRAVAIL_CLIENT_ID || !env.FRANCE_TRAVAIL_CLIENT_SECRET) throw new ProviderError("AUTH", "France Travail OAuth credentials are not configured (FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET).", false);
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: env.FRANCE_TRAVAIL_CLIENT_ID, client_secret: env.FRANCE_TRAVAIL_CLIENT_SECRET, scope: "api_offresdemploiv2 o2dsoffre" });
    let lastError: unknown;
    for (const url of tokenUrls) {
      try {
        const data = await (await fixedFetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, { retries: 1 })).json() as { access_token?: string; expires_in?: number };
        if (!data.access_token) throw new ProviderError("AUTH", "France Travail returned no access token.", false);
        this.token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 1_200) * 1000 }; return data.access_token;
      } catch (error) { lastError = error; if (error instanceof ProviderError && error.code === "AUTH") throw new ProviderError("AUTH", "France Travail rejected the client credentials.", false); }
    }
    throw lastError;
  }
  private async get(path: string, params?: URLSearchParams) {
    const token = await this.accessToken();
    const response = await fixedFetch(`${apiBase}${path}${params ? `?${params}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    // 204 means "no results" and carries an empty body; 206 means "partial page, more available".
    if (response.status === 204) return { status: 204, data: null as unknown, total: 0 };
    const text = await response.text(); const total = Number(response.headers.get("content-range")?.split("/")[1]) || 0;
    return { status: response.status, data: text ? JSON.parse(text) as unknown : null, total };
  }
  normalize(raw: unknown): NormalizedJob {
    const offer = raw as FtOffer; const url = detailUrl(offer.id); const { min, max } = parseSalary(offer.salaire?.libelle);
    const city = (offer.lieuTravail?.libelle ?? "").replace(/^\s*\d{2,3}\s*-\s*/, "").trim(); const dept = offer.lieuTravail?.libelle?.match(/^\s*(\d{2,3})\s*-/)?.[1];
    const contract = [offer.typeContrat ? contractNames[offer.typeContrat] ?? offer.typeContrat : offer.typeContratLibelle, offer.alternance ? "Alternance" : "", offer.natureContrat].filter(Boolean).join(" · ");
    return normalizedJobSchema.parse({ source: this.id, sourceJobId: offer.id, sourceUrl: url, applicationUrl: validUrl(offer.contact?.urlPostulation, offer.origineOffre?.urlOrigine) ?? url, companyName: offer.entreprise?.nom?.trim() || "Employer not disclosed", title: offer.intitule, location: city ? (dept ? `${city} (${dept})` : city) : "France", contractType: contract || "UNKNOWN", salaryMin: min, salaryMax: max, descriptionRaw: offer.description || "", descriptionClean: offer.description || "", skillsRequired: (offer.competences ?? []).map(item => item.libelle?.trim() || "").filter(Boolean).slice(0, 60), languagesRequired: (offer.langues ?? []).map(item => item.libelle?.trim() || "").filter(Boolean), experienceMin: minExperience(offer), publishedAt: offer.dateCreation ? new Date(offer.dateCreation).toISOString() : null, extractor: "france_travail_official_api", sourceMetadata: { salaryText: offer.salaire?.libelle, postalCode: offer.lieuTravail?.codePostal, sector: offer.secteurActiviteLibelle, updatedAt: offer.dateActualisation } });
  }
  async search(request: SearchRequest): Promise<ProviderSearchResult> {
    await this.accessToken();
    const found = new Map<string, NormalizedJob>(); let fetched = 0, invalid = 0; const warnings: string[] = [];
    const queries = [...new Set(request.queries.map(query => query.trim()).filter(Boolean))].slice(0, 10); if (!queries.length) queries.push("");
    const remotePreferred = request.remotePreferences.some(item => /remote|distance|teletravail/i.test(fold(item))) || request.locations.some(item => /\bremote\b|teletravail/.test(fold(item)));
    const groups = geoGroups(request.locations, remotePreferred); for (const group of groups) if (group.note) warnings.push(group.note);
    if (request.locations.some(location => resolvePlace(fold(location))?.country === "LU" || /luxembourg/.test(fold(location)))) warnings.push("France Travail does not list Luxembourg vacancies; use Luxembourg employer career pages (Greenhouse/Lever/Ashby/company pages) for cross-border jobs.");
    const windows = [1, 3, 7, 14, 31]; const published = windows.find(days => days >= request.datePostedWindow) ?? 31;
    let calls = 0;
    outer: for (const group of groups) for (const query of queries) {
      for (let start = 0; start <= 1000 && found.size < request.maxJobs; start += pageSize) {
        const params = new URLSearchParams({ range: `${start}-${Math.min(start + pageSize - 1, 1149)}`, sort: "1", publieeDepuis: String(published) });
        if (query) params.set("motsCles", query); if (group.departments) params.set("departement", group.departments.join(","));
        if (calls++) await sleep(120);
        let page; try { page = await this.get("/search", params); } catch (error) { warnings.push(`${query || "all offers"}${group.departments ? ` [${group.departments.join(",")}]` : ""}: ${(error as Error).message}`); if (error instanceof ProviderError && (error.code === "AUTH" || error.code === "RATE_LIMIT")) break outer; break; }
        const results = (page.data as { resultats?: FtOffer[] } | null)?.resultats ?? [];
        for (const raw of results) { fetched++; if (found.has(raw.id)) continue; try { found.set(raw.id, this.normalize(raw)); } catch { invalid++; } }
        if (page.status !== 206 || results.length < pageSize) break;
      }
    }
    const jobs = [...found.values()].slice(0, request.maxJobs);
    return { jobs, stats: { fetched, valid: jobs.length, invalid }, warnings };
  }
  async fetchDetails(url: string) {
    const id = decodeURIComponent(url.split("/").pop() ?? ""); if (!id) throw new ProviderError("PARSER_CHANGED", "Missing offer ID.", false);
    const result = await this.get(`/${encodeURIComponent(id)}`); if (!result.data) throw new ProviderError("NOT_FOUND", "Offer no longer available.", false);
    return this.normalize(result.data);
  }
  /** Search results only cover recent offers, so withdrawn vacancies are detected by asking for each known offer directly. */
  async verify(ids: string[]) {
    const out: Record<string, "ACTIVE" | "GONE"> = {};
    for (const [index, id] of ids.entries()) {
      if (index) await sleep(150);
      try { const result = await this.get(`/${encodeURIComponent(id)}`); out[id] = result.data ? "ACTIVE" : "GONE"; }
      catch (error) { if (error instanceof ProviderError && error.code === "NOT_FOUND") out[id] = "GONE"; else throw error; }
    }
    return out;
  }
  async healthCheck(): Promise<ProviderHealth> {
    try { await this.accessToken(); const result = await this.get("/search", new URLSearchParams({ range: "0-0", motsCles: "data" })); return { status: "HEALTHY", detail: `Credentials accepted; API reachable${result.total ? ` (${result.total} offers match a test query)` : ""}.` }; }
    catch (error) { const code = error instanceof ProviderError ? error.code : "UNKNOWN"; return { status: code === "AUTH" ? "FAILED" : "DEGRADED", detail: (error as Error).message }; }
  }
}
