import { normalizedJobSchema, type NormalizedJob } from "@/lib/schemas";
import { fold } from "@/matching/score";
import { cleanText } from "@/providers/core";
import type { SearchRequest } from "@/providers/types";

/**
 * Job portals read through third-party Apify actors. Each definition turns the owner's search profiles into actor input
 * (a few title × place searches, so the bill stays small) and maps the actor's records to the shared job schema.
 * Canonical source URLs and IDs match those built from job-alert emails, so both routes merge into one job.
 */
export type PortalId = "linkedin" | "indeed" | "hellowork" | "wttj";
export type ActorRunPlan = { label: string; maxItems: number; input: Record<string, unknown> };
export type Portal = { id: PortalId; name: string; actor: string; usdPerItem: number; runs(request: SearchRequest, budget: number): ActorRunPlan[]; normalize(item: Record<string, unknown>): NormalizedJob };
type Item = Record<string, unknown>;

export const str = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
const num = (value: unknown) => { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; };
const record = (value: unknown): Item => value && typeof value === "object" && !Array.isArray(value) ? value as Item : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const compact = (value: Item) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
const httpsUrl = (value: unknown) => { const text = str(value); try { return new URL(text).protocol === "https:" ? text : undefined; } catch { return undefined; } };
const hostOf = (value: unknown) => { try { return new URL(str(value)).hostname.replace(/^www\./, "") || undefined; } catch { return undefined; } };
export const unknownEmployer = "Employer not disclosed";

export function iso(value: unknown) {
  const text = str(value); if (!text) return null;
  const date = new Date(/^\d{10,13}$/.test(text) ? Number(text.length === 10 ? `${text}000` : text) : text);
  return Number.isNaN(date.getTime()) || date.getFullYear() < 2000 ? null : date.toISOString();
}

/** Yearly euros from a range and its period. Hourly, daily or unstated periods stay unknown rather than being guessed. */
export function yearly(min: number | null, max: number | null, period: string) {
  const folded = fold(period); const factor = /year|annu|\ban\b|^an$/.test(folded) ? 1 : /month|mois|mensu/.test(folded) ? 12 : 0;
  const scale = (value: number | null) => factor && value !== null && value > 0 ? Math.round(value * factor) : null;
  const salaryMin = scale(min), salaryMax = scale(max);
  return { salaryMin: salaryMin !== null && salaryMin < 1_000 ? null : salaryMin, salaryMax: salaryMax !== null && salaryMax < 1_000 ? null : salaryMax };
}
function amount(raw: string, thousands: boolean) {
  let text = raw.replace(/[\s  ]/g, ""); const decimal = text.match(/[.,](\d{1,2})$/);
  text = decimal ? `${text.slice(0, -decimal[0].length).replace(/[.,]/g, "")}.${decimal[1]}` : text.replace(/[.,]/g, "");
  const value = Number(text); return Number.isFinite(value) ? value * (thousands ? 1_000 : 1) : null;
}
/** Parses salary labels such as "44 000 - 52 000 € / an", "€45,000.00/yr - €55,000.00/yr" or "45K€ - 55K€ par an". */
export function salaryFromText(text: string) {
  // Lower case without accents but with symbols kept: `fold` would drop the "€" and "/" these labels depend on.
  const lower = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); if (!/€|\beur\b|\$|£/.test(lower)) return { salaryMin: null, salaryMax: null };
  const period = /\/\s*(yr|year|an)\b|par an|annuel|per year|a year/.test(lower) ? "year" : /\/\s*(mo|month|mois)\b|par mois|mensuel|per month|a month/.test(lower) ? "month" : "";
  const values = [...text.matchAll(/(\d{1,3}(?:[\s  .,]\d{3})*(?:[.,]\d{1,2})?)\s*([kK])?/g)].map(match => amount(match[1]!, Boolean(match[2]))).filter((value): value is number => value !== null && value > 0);
  return values.length ? yearly(Math.min(...values), values.length > 1 ? Math.max(...values) : null, period) : { salaryMin: null, salaryMax: null };
}
export function remoteFrom(text: string): NormalizedJob["remoteType"] {
  const folded = fold(text);
  if (/\b(hybrid|hybride|teletravail partiel|partial remote|partially remote)\b/.test(folded)) return "HYBRID";
  if (/\b(full remote|fully remote|remote|teletravail complet|100 ?% teletravail)\b/.test(folded)) return "REMOTE";
  if (/\b(on-site|onsite|sur site|presentiel)\b/.test(folded)) return "ONSITE";
  return "UNKNOWN";
}
export function countryFrom(text: string, fallback = "FR") {
  const folded = fold(text);
  return /luxembourg/.test(folded) ? "LU" : /belgi/.test(folded) ? "BE" : /suisse|switzerland|schweiz/.test(folded) ? "CH" : /allemagne|germany|deutschland/.test(folded) ? "DE" : fallback;
}

type Place = { label: string; remote: boolean; country: string };
const remoteWords = /\b(remote|teletravail|a distance|full remote|anywhere)\b/;
/** Up to `limit` places from the search profiles; a remote preference is always kept so remote roles are searched too. */
export function searchPlaces(request: SearchRequest, limit = 3): Place[] {
  const onsite = new Map<string, Place>(); let remote: Place | null = null;
  for (const raw of request.locations) {
    const label = raw.trim(); if (!label) continue; const folded = fold(label);
    if (remoteWords.test(folded)) { const rest = label.replace(/\b(remote|télétravail|teletravail|à distance|a distance|full remote|anywhere)\b/gi, "").replace(/[\s,–-]+/g, " ").trim(); remote ??= { label: rest || "France", remote: true, country: countryFrom(rest || "France") }; }
    else if (!onsite.has(folded)) onsite.set(folded, { label, remote: false, country: countryFrom(label) });
  }
  if (!remote && request.remotePreferences.some(item => remoteWords.test(fold(item)))) remote = { label: "France", remote: true, country: "FR" };
  const places = [...onsite.values()].slice(0, remote ? limit - 1 : limit);
  if (remote) places.push(remote);
  return places.length ? places : [{ label: "France", remote: false, country: "FR" }];
}
export const searchQueries = (request: SearchRequest, limit = 3) => [...new Map(request.queries.map(query => query.trim()).filter(Boolean).map(query => [fold(query), query])).values()].slice(0, limit);
/** Title × place pairs ordered diagonally (each title and each place appears early) and capped to keep runs cheap. */
export function searchPairs(request: SearchRequest, maxPairs: number) {
  const queries = searchQueries(request), places = searchPlaces(request); const pairs: { query: string; place: Place }[] = [];
  for (let sum = 0; sum < queries.length + places.length - 1 && pairs.length < maxPairs; sum++) for (let index = 0; index <= sum && pairs.length < maxPairs; index++) {
    const query = queries[index], place = places[sum - index]; if (query && place) pairs.push({ query, place });
  }
  return pairs;
}
const split = (budget: number, parts: number) => Math.max(1, Math.ceil(budget / Math.max(parts, 1)));

export const linkedinPortal: Portal = {
  id: "linkedin", name: "LinkedIn", actor: "curious_coder/linkedin-jobs-scraper", usdPerItem: 0.002,
  runs(request, budget) {
    const pairs = searchPairs(request, 6); if (!pairs.length) return [];
    const window = request.datePostedWindow <= 1 ? "r86400" : request.datePostedWindow <= 7 ? "r604800" : "r2592000";
    const urls = pairs.map(({ query, place }) => { const url = new URL("https://www.linkedin.com/jobs/search/"); url.searchParams.set("keywords", query); url.searchParams.set("location", place.label); url.searchParams.set("f_TPR", window); if (place.remote) url.searchParams.set("f_WT", "2"); return url.toString(); });
    return [{ label: `LinkedIn (${urls.length} searches)`, maxItems: budget, input: { urls, limitPerSource: split(budget, urls.length), scrapeCompany: false } }];
  },
  normalize(item) {
    const id = str(item.id) || str(item.link).match(/(\d{6,})/)?.[1] || ""; const location = str(item.location) || "France";
    const html = str(item.descriptionHtml); const text = str(item.descriptionText);
    return normalizedJobSchema.parse({ source: "linkedin", sourceJobId: id, sourceUrl: linkedinUrl(id), applicationUrl: httpsUrl(item.applyUrl), companyName: str(item.companyName) || unknownEmployer, companyDomain: hostOf(item.companyWebsite), title: str(item.title), location, country: countryFrom(location), remoteType: remoteFrom(`${location} ${str(item.title)}`), contractType: str(item.employmentType) || "UNKNOWN", ...salaryFromText(str(item.salary)), descriptionRaw: html || text, descriptionClean: cleanText(html) || text, publishedAt: iso(item.postedAt), extractor: `apify:${linkedinPortal.actor}`, sourceMetadata: compact({ seniority: str(item.seniorityLevel), applicants: str(item.applicantsCount), industries: str(item.industries) }) });
  }
};

const indeedHosts: Record<string, string> = { LU: "lu.indeed.com", BE: "be.indeed.com", CH: "ch.indeed.com", DE: "de.indeed.com" };
/** Canonical posting URLs, shared with the job-alert email parser so both routes produce the same source identity. */
export const linkedinUrl = (id: string) => `https://www.linkedin.com/jobs/view/${id}/`;
export const helloworkUrl = (id: string) => `https://www.hellowork.com/fr-fr/emplois/${id}.html`;
export const indeedUrl = (host: string | undefined, key: string) => `https://${host && /^[a-z]{2}\.indeed\.com$/.test(host) ? host : "fr.indeed.com"}/viewjob?jk=${encodeURIComponent(key)}`;
export const indeedPortal: Portal = {
  id: "indeed", name: "Indeed", actor: "borderline/indeed-scraper", usdPerItem: 0.005,
  runs(request, budget) {
    const pairs = searchPairs(request, 6); if (!pairs.length) return [];
    const days = [1, 3, 7, 14].find(value => value >= request.datePostedWindow) ?? 14;
    const urls = pairs.map(({ query, place }) => { const url = new URL(`https://${indeedHosts[place.country] ?? "fr.indeed.com"}/jobs`); url.searchParams.set("q", query); url.searchParams.set("l", place.remote ? "Télétravail" : place.label); url.searchParams.set("fromage", String(days)); url.searchParams.set("sort", "date"); return url.toString(); });
    return [{ label: `Indeed (${urls.length} searches)`, maxItems: budget, input: { urls, maxRowsPerUrl: split(budget, urls.length), maxRows: budget, enableUniqueJobs: true, includeSimilarJobs: false } }];
  },
  normalize(item) {
    const jobUrl = str(item.jobUrl); let key = str(item.jobKey); try { key ||= new URL(jobUrl).searchParams.get("jk") ?? ""; } catch { /* no usable URL */ }
    key = key.toLowerCase();
    const place = record(item.location); const location = str(place.formattedAddressShort) || str(place.city) || str(place.fullAddress) || "France";
    const salary = record(item.salary);
    const html = str(item.descriptionHtml); const text = str(item.descriptionText); const code = str(place.countryCode).toUpperCase();
    const pay = yearly(num(salary.salaryMin), num(salary.salaryMax), str(salary.salaryType));
    return normalizedJobSchema.parse({ source: "indeed", sourceJobId: key, sourceUrl: indeedUrl(hostOf(jobUrl), key), applicationUrl: httpsUrl(item.applyUrl), companyName: str(item.companyName) || str(item.sourceEmployerName) || unknownEmployer, companyDomain: hostOf(record(item.companyLinks).corporateWebsite), title: str(item.title) || str(item.displayTitle), location, country: code.length === 2 ? code : countryFrom(location), remoteType: item.isRemote === true ? "REMOTE" : remoteFrom([...list(item.attributes), ...list(item.workingSystem)].map(str).join(" ")), contractType: list(item.jobType).map(str).filter(Boolean).join(", ") || "UNKNOWN", ...(pay.salaryMin || pay.salaryMax ? pay : salaryFromText(str(salary.salaryText))), salaryCurrency: str(salary.salaryCurrency).length === 3 ? str(salary.salaryCurrency).toUpperCase() : "EUR", descriptionRaw: html || text, descriptionClean: cleanText(html) || text, publishedAt: iso(item.datePublished), extractor: `apify:${indeedPortal.actor}`, sourceMetadata: compact({ easyApply: item.isEasyApply === true ? true : undefined, sector: str(item.companySector) }) });
  }
};

const wttjContracts: Record<string, string> = { full_time: "CDI", fixed_term: "CDD", temporary: "CDD", internship: "Stage", apprenticeship: "Alternance", freelance: "Freelance", part_time: "Temps partiel", vie: "VIE", graduate_program: "Graduate program" };
const wttjRemote: Record<string, NormalizedJob["remoteType"]> = { fulltime: "REMOTE", partial: "HYBRID", punctual: "HYBRID", no: "ONSITE" };
export function wttjReference(url: string) { const match = url.match(/welcometothejungle\.com\/[a-z]{2}\/companies\/([^/?#]+)\/jobs\/([^/?#]+)/); return match ? { id: `${match[1]}/${match[2]}`, url: `https://www.welcometothejungle.com/fr/companies/${match[1]}/jobs/${match[2]}` } : null; }
export const wttjPortal: Portal = {
  id: "wttj", name: "Welcome to the Jungle", actor: "clearpath/welcome-to-the-jungle-jobs-api", usdPerItem: 0.003,
  runs(request, budget) {
    const pairs = searchPairs(request, 3); const datePosted = ["1", "3", "7", "14", "30"].find(value => Number(value) >= request.datePostedWindow) ?? "30";
    return pairs.map(({ query, place }) => ({ label: `${query} · ${place.remote ? "remote" : place.label}`, maxItems: split(budget, pairs.length), input: { query, location: place.label, maxItems: split(budget, pairs.length), includeDetails: true, websiteCountry: "fr", sortBy: "date", datePosted, ...(place.remote ? { remote: ["fulltime", "partial"] } : {}) } }));
  },
  normalize(item) {
    const reference = wttjReference(str(item.url)); const office = record(list(item.offices)[0]); const headquarter = record(item.organizationHeadquarter);
    const location = str(office.city) || str(headquarter.city) || "France"; const country = (str(office.country_code) || str(headquarter.country_code)).toUpperCase();
    const description = [str(item.description), str(item.profile) && `Profil recherché\n${str(item.profile)}`, list(item.keyMissions).length ? `Missions\n${list(item.keyMissions).map(str).join("\n")}` : ""].filter(Boolean).join("\n\n");
    const skills = list(item.skills).map(skill => { const name = record(record(skill).name); return str(name.fr) || str(name.en); }).filter(Boolean).slice(0, 50);
    const experience = num(item.experienceLevel);
    return normalizedJobSchema.parse({ source: "wttj", sourceJobId: reference?.id ?? (str(item.reference) || str(item.id)), sourceUrl: reference?.url ?? str(item.url), applicationUrl: httpsUrl(item.applyUrl), companyName: str(item.organizationName) || unknownEmployer, companyDomain: hostOf(item.organizationWebsite), title: str(item.name), location, country: country.length === 2 ? country : countryFrom(location), remoteType: wttjRemote[str(item.remote)] ?? "UNKNOWN", contractType: wttjContracts[str(item.contractType)] ?? (str(item.contractType) || "UNKNOWN"), ...yearly(num(item.salaryMin), num(item.salaryMax), str(item.salaryPeriod)), salaryCurrency: str(item.salaryCurrency).length === 3 ? str(item.salaryCurrency).toUpperCase() : "EUR", descriptionRaw: description, descriptionClean: cleanText(description), skillsRequired: skills, experienceMin: experience !== null && experience >= 0 && experience <= 80 ? Math.floor(experience) : null, publishedAt: iso(item.publishedAt), extractor: `apify:${wttjPortal.actor}`, sourceMetadata: compact({ sector: str(item.organizationIndustry), category: str(item.category) }) });
  }
};

const helloworkTelework: Record<string, NormalizedJob["remoteType"]> = { FULL: "REMOTE", PARTIAL: "HYBRID", OCCASIONAL: "HYBRID", NONE: "ONSITE" };
export const helloworkPortal: Portal = {
  id: "hellowork", name: "HelloWork", actor: "solidcode/hellowork-scraper", usdPerItem: 0.001,
  runs(request, budget) {
    const queries = searchQueries(request); const places = searchPlaces(request).filter(place => place.country === "FR"); if (!queries.length || !places.length) return [];
    const datePosted = request.datePostedWindow <= 1 ? "24h" : request.datePostedWindow <= 3 ? "3d" : request.datePostedWindow <= 7 ? "1w" : "1m"; const perPlace = split(budget, places.length);
    return places.map(place => ({ label: `HelloWork · ${place.remote ? "télétravail" : place.label}`, maxItems: perPlace, input: { searchQueries: queries, location: place.remote ? "" : place.label, maxResults: split(perPlace, queries.length), datePosted, includeJobDetails: true, ...(place.remote ? { telework: ["FULL", "PARTIAL"] } : {}) } }));
  },
  normalize(item) {
    const id = str(item.jobId) || str(item.jobUrl).match(/emplois\/(\d+)\.html/)?.[1] || ""; const location = str(item.location) || [str(item.city), str(item.postalCode)].filter(Boolean).join(" ") || "France";
    const html = str(item.descriptionHtml); const text = str(item.descriptionText) || str(item.snippet); const pay = yearly(num(item.salaryMin), num(item.salaryMax), str(item.salaryPeriod));
    return normalizedJobSchema.parse({ source: "hellowork", sourceJobId: id, sourceUrl: helloworkUrl(id), companyName: str(item.company) || unknownEmployer, companyDomain: hostOf(item.companyUrl), title: str(item.title), location, country: countryFrom(`${location} ${str(item.country)}`), remoteType: helloworkTelework[str(item.telework).toUpperCase()] ?? remoteFrom(str(item.telework)), contractType: str(item.contractType) || str(item.employmentTypeRaw) || "UNKNOWN", ...(pay.salaryMin || pay.salaryMax ? pay : salaryFromText(str(item.salary))), descriptionRaw: html || text, descriptionClean: cleanText(html) || text, skillsRequired: list(item.skills).map(str).filter(Boolean).slice(0, 50), publishedAt: iso(item.datePosted), expiresAt: iso(item.validThrough), extractor: `apify:${helloworkPortal.actor}`, sourceMetadata: compact({ sector: str(item.sector), experience: str(item.experience), education: str(item.education) }) });
  }
};

export const portals: Record<PortalId, Portal> = { linkedin: linkedinPortal, indeed: indeedPortal, hellowork: helloworkPortal, wttj: wttjPortal };
