import type { CandidateData, NormalizedJob, SearchProfileData } from "@/lib/schemas";
import { areaAliases, europeanCountryWords, languageAliases, nonEuropeWords, places, roleGroups, skills, type Place, type SkillDef } from "@/matching/knowledge";

// Bump when scoring semantics change so stored results can be recomputed.
export const MATCH_ENGINE_VERSION = 1;

export type MatchLabel = "STRONG" | "GOOD" | "POSSIBLE" | "LOW";
export type MatchComponentKey = "title" | "skills" | "experience" | "location" | "language" | "salary" | "contract" | "keywords";
export type MatchComponent = { key: MatchComponentKey; label: string; score: number; max: number; evidence: string[]; gaps: string[]; uncertain: string[] };
export type MatchResult = {
  engineVersion: number;
  score: number;
  label: MatchLabel;
  confidence: number;
  components: MatchComponent[];
  matchedSkills: { skill: string; evidence: string }[];
  missingSkills: string[];
  transferableSkills: string[];
  blockers: string[];
  uncertain: string[];
  summary: string;
};

export const labelFor = (score: number): MatchLabel => score >= 80 ? "STRONG" : score >= 65 ? "GOOD" : score >= 50 ? "POSSIBLE" : "LOW";
export const labelText: Record<MatchLabel, string> = { STRONG: "Strong Match", GOOD: "Good Match", POSSIBLE: "Possible Match", LOW: "Low Match" };

export function fold(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
    .replace(/[^a-z0-9+#./]+/g, " ").replace(/\s+/g, " ").trim();
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const termCache = new Map<string, RegExp>();
export function hasTerm(foldedText: string, term: string) {
  const key = fold(term); if (!key) return false;
  let regex = termCache.get(key); if (!regex) { regex = new RegExp(`(?<![a-z0-9])${escapeRegex(key)}(?![a-z0-9])`); termCache.set(key, regex); }
  return regex.test(foldedText);
}
const unique = <T,>(values: T[]) => [...new Set(values)];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

const stopWords = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "and", "the", "of", "for", "a", "h", "f", "m", "w", "x", "d", "au", "aux", "chez", "senior", "junior", "confirme", "cdi", "cdd"]);
const tokens = (value: string) => fold(value).split(" ").filter(token => token && !stopWords.has(token));
function titleSimilarity(role: string, title: string) {
  const a = fold(role), b = fold(title); if (!a || !b) return 0;
  if (hasTerm(b, a) || hasTerm(a, b)) return 0.95;
  const left = new Set(tokens(role)), right = new Set(tokens(title)); if (!left.size || !right.size) return 0;
  let shared = 0; for (const token of left) if (right.has(token)) shared++;
  const jaccard = shared / (left.size + right.size - shared);
  return jaccard >= 0.6 ? 0.8 : jaccard >= 0.34 ? 0.55 : jaccard > 0 && shared >= 2 ? 0.4 : 0;
}
const patternCache = new Map<string, RegExp>();
const patternOf = (source: string) => { let regex = patternCache.get(source); if (!regex) { regex = new RegExp(source); patternCache.set(source, regex); } return regex; };
export const groupsFor = (foldedText: string) => roleGroups.filter(group => group.phrases.some(phrase => hasTerm(foldedText, phrase)) || (group.patterns ?? []).some(source => patternOf(source).test(foldedText)));

const skillIndex = new Map<string, SkillDef>();
for (const skill of skills) { skillIndex.set(fold(skill.label), skill); for (const alias of skill.aliases) skillIndex.set(fold(alias), skill); }
const skillAliasMatches = (foldedText: string) => skills.filter(skill => skill.aliases.some(alias => hasTerm(foldedText, alias)) || hasTerm(foldedText, skill.label));

type Evidenced = { id: string; label: string; evidence: string; family?: string; core: boolean };
function candidateSkills(candidate: CandidateData): Evidenced[] {
  const fields: [string, string[], boolean][] = [["coreSkills", candidate.coreSkills, true], ["secondarySkills", candidate.secondarySkills, false], ["tools", candidate.tools, false], ["technologies", candidate.technologies, false], ["certifications", candidate.certifications, false]];
  const found = new Map<string, Evidenced>();
  for (const [field, values, core] of fields) for (const value of values) {
    const folded = fold(value); if (!folded) continue;
    const direct = skillIndex.get(folded); const contained = direct ? [direct] : skillAliasMatches(folded);
    const ids = contained.length ? contained : [{ id: `custom:${folded}`, label: value, aliases: [], family: undefined } as SkillDef];
    for (const skill of ids) { const existing = found.get(skill.id); if (!existing || (core && !existing.core)) found.set(skill.id, { id: skill.id, label: skill.label === value || skill.id.startsWith("custom:") ? value : skill.label, evidence: `${field}: ${value}`, family: skill.family, core: core || existing?.core === true }); }
  }
  return [...found.values()];
}

const experienceBefore = /(\d{1,2})\s*\+?\s*(?:ans?|years?|yrs?)\b[^.\n]{0,50}?exp[eé]rience/i;
const experienceAfter = /exp[eé]rience[^.\n]{0,50}?(\d{1,2})\s*\+?\s*(?:ans?|years?|yrs?)\b/i;
function requiredYears(job: NormalizedJob) {
  if (job.experienceMin !== null && job.experienceMin !== undefined) return job.experienceMin;
  const text = job.descriptionClean.normalize("NFC"); const match = text.match(experienceBefore) ?? text.match(experienceAfter);
  const years = match ? Number(match[1]) : NaN; return Number.isFinite(years) && years <= 25 ? years : null;
}
function jobLevel(foldedTitle: string, foldedText: string) {
  if (/\b(stage|stagiaire|intern|internship|alternance|alternant|apprenti|apprentissage|apprenticeship|working student|werkstudent)\b/.test(foldedTitle)) return -1;
  if (/\b(junior|jr|debutant|entry level|graduate|jeune diplome)\b/.test(foldedTitle)) return 0;
  if (/\b(head of|directeur|directrice|director|vp|vice president|chief|cto|cio)\b/.test(foldedTitle)) return 3;
  if (/\b(responsable|manager|management)\b/.test(foldedTitle) && !/product|project|data|analyst|account|program/.test(foldedTitle.replace(/manager/g, ""))) return 3;
  if (/\b(senior|sr|confirme|experimente|lead|principal|staff|expert|architect|architecte)\b/.test(foldedTitle)) return 2;
  if (/\b(junior|debutant)\b/.test(foldedText.slice(0, 600))) return 0;
  return 1;
}
const candidateLevel = (years: number) => years >= 7 ? 2 : years >= 3 ? 1 : 0;

function inferRemote(job: NormalizedJob, foldedText: string): { type: NormalizedJob["remoteType"]; inferred: boolean } {
  if (job.remoteType !== "UNKNOWN") return { type: job.remoteType, inferred: false };
  if (/\b(full remote|100 remote|fully remote|teletravail complet|teletravail total|remote first|remote only|entierement a distance|a 100 en teletravail|100 teletravail)\b/.test(foldedText) || /^remote\b|\bremote\s*[-–(]/.test(fold(job.location))) return { type: "REMOTE", inferred: true };
  if (/\b(hybride|hybrid|teletravail partiel|\d\s*jours? (?:de )?teletravail|jours? de teletravail|teletravail possible|teletravail \d|teletravail hybride|flex remote)\b/.test(foldedText)) return { type: "HYBRID", inferred: true };
  if (/\b(remote|teletravail|work from home|travail a distance)\b/.test(foldedText.slice(0, 1500)) && !/\b(no remote|pas de teletravail|sans teletravail|on site only|sur site uniquement)\b/.test(foldedText)) return { type: "HYBRID", inferred: true };
  return { type: "UNKNOWN", inferred: false };
}

export function resolvePlace(foldedLocation: string): Place | null {
  let best: { place: Place; length: number } | null = null;
  for (const place of places) for (const alias of [place.name, ...(place.aliases ?? [])]) {
    const folded = fold(alias);
    if (hasTerm(foldedLocation, folded) && (!best || folded.length > best.length)) best = { place, length: folded.length };
  }
  return best?.place ?? null;
}
export const areasIn = (foldedText: string) => Object.entries(areaAliases).filter(([, aliases]) => aliases.some(alias => hasTerm(foldedText, alias))).map(([area]) => area);
function distanceKm(a: Place, b: Place) {
  const radians = (value: number) => value * Math.PI / 180; const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.25; // road-distance factor
}

const languageOf = (value: string) => { const folded = fold(value); return Object.entries(languageAliases).filter(([, aliases]) => aliases.some(alias => alias.length > 2 ? hasTerm(folded, alias) : false)).map(([language]) => language); };
const strongQualifier = "required|obligatoire|exige|indispensable|fluent|courant|natif|native|bilingue|bilingual|maitrise|c1|c2|requis|mandatory|must";
const weakQualifier = "souhaite|apprecie|atout|plus|nice|preferred|asset|bonus|serait un plus|a plus";
function languageDemands(foldedText: string) {
  const strong = new Set<string>(), weak = new Set<string>();
  for (const [language, aliases] of Object.entries(languageAliases)) for (const alias of aliases.filter(item => item.length > 2)) {
    const regexStrong = new RegExp(`(?:${strongQualifier})[^.\\n]{0,40}(?<![a-z0-9])${alias}(?![a-z0-9])|(?<![a-z0-9])${alias}(?![a-z0-9])[^.\\n]{0,40}(?:${strongQualifier})`);
    const regexWeak = new RegExp(`(?:${weakQualifier})[^.\\n]{0,40}(?<![a-z0-9])${alias}(?![a-z0-9])|(?<![a-z0-9])${alias}(?![a-z0-9])[^.\\n]{0,40}(?:${weakQualifier})`);
    if (regexStrong.test(foldedText)) strong.add(language); else if (regexWeak.test(foldedText)) weak.add(language);
  }
  return { strong, weak };
}
const stopwordLists: Record<string, string[]> = {
  french: ["le", "la", "les", "des", "et", "vous", "nous", "pour", "dans", "avec", "une", "est", "sur"],
  english: ["the", "and", "you", "our", "with", "for", "will", "are", "your", "to", "of"],
  german: ["der", "die", "das", "und", "mit", "wir", "sie", "fur", "ein", "eine", "ihre", "sind"],
  dutch: ["het", "een", "van", "wij", "jij", "voor", "met", "zijn", "bij", "ons"]
};
function writtenLanguage(foldedText: string) {
  const words = foldedText.slice(0, 1500).split(" "); if (words.length < 25) return null;
  const scores = Object.entries(stopwordLists).map(([language, list]) => [language, words.filter(word => list.includes(word)).length / words.length] as const).sort((a, b) => b[1] - a[1]);
  return scores[0]![1] >= 0.06 ? scores[0]![0] : null;
}

const contractKind = (value: string) => {
  const folded = fold(value);
  if (/\b(stage|stagiaire|intern|internship)\b/.test(folded)) return "internship";
  if (/\b(alternance|apprenti|apprentissage|apprenticeship|contrat pro|professionnalisation)\b/.test(folded)) return "apprenticeship";
  if (/\b(cdi|permanent|full time|fulltime|temps plein|indefinite|unbefristet)\b/.test(folded)) return "permanent";
  if (/\b(cdd|fixed term|temporary|fixed-term|mission|interim|temporaire)\b/.test(folded)) return "fixed-term";
  if (/\b(freelance|independant|contractor|contract|consultant|portage)\b/.test(folded)) return "freelance";
  return null;
};

export function scoreJob(candidate: CandidateData, job: NormalizedJob, profiles: SearchProfileData[] = []): MatchResult {
  const foldedTitle = fold(job.title), foldedDescription = fold(job.descriptionClean), foldedLocation = fold(job.location);
  const foldedText = `${foldedTitle} ${foldedLocation} ${foldedDescription} ${fold(job.skillsRequired.join(" "))}`;
  const blockers: string[] = []; const globalUncertain: string[] = [];
  const components: MatchComponent[] = [];
  const component = (key: MatchComponentKey, label: string, max: number): MatchComponent => { const item = { key, label, score: 0, max, evidence: [], gaps: [], uncertain: [] } as MatchComponent; components.push(item); return item; };

  // Hard exclusions come from the reviewed profile and the active search profiles.
  const companyFold = fold(job.companyName);
  for (const term of [...candidate.excludedKeywords, ...profiles.flatMap(profile => profile.excludedKeywords)]) if (hasTerm(foldedText, term)) blockers.push(`Excluded term: ${term}`);
  for (const term of candidate.excludedCompanies) if (hasTerm(companyFold, term)) blockers.push(`Excluded company: ${term}`);
  for (const term of candidate.excludedTitles) if (hasTerm(foldedTitle, term)) blockers.push(`Excluded title: ${term}`);
  for (const term of candidate.excludedIndustries) if (hasTerm(foldedText, term)) blockers.push(`Excluded industry: ${term}`);

  // 1. Title / role fit
  const titleC = component("title", "Role fit", 22);
  const roles: { value: string; weight: number }[] = [
    ...candidate.targetRoles.map(value => ({ value, weight: 1 })), ...profiles.flatMap(profile => profile.targetTitles).map(value => ({ value, weight: 1 })),
    ...candidate.secondaryRoles.map(value => ({ value, weight: 0.85 })), ...profiles.flatMap(profile => profile.alternativeTitles).map(value => ({ value, weight: 0.85 }))
  ];
  const jobGroups = groupsFor(foldedTitle);
  if (!roles.length) { titleC.score = titleC.max * 0.5; titleC.uncertain.push("No target roles in your profile or search profiles."); }
  else {
    let best = 0, bestRole = "", via = "";
    for (const role of roles) {
      const roleGroupsMatched = groupsFor(fold(role.value)); const shared = roleGroupsMatched.find(group => jobGroups.some(other => other.id === group.id));
      const direct = titleSimilarity(role.value, job.title) * role.weight; const grouped = shared ? 0.92 * role.weight : 0;
      const value = Math.max(direct, grouped); if (value > best) { best = value; bestRole = role.value; via = shared && grouped >= direct ? `same role family (${shared.label})` : "similar wording"; }
    }
    titleC.score = titleC.max * best;
    if (best >= 0.5) titleC.evidence.push(`"${job.title}" matches your target "${bestRole}" (${via}).`);
    else titleC.gaps.push(`"${job.title}" does not resemble your target roles.`);
  }

  // 2. Skills
  const skillsC = component("skills", "Skills & technologies", 30);
  const mine = candidateSkills(candidate);
  const requiredHeader = foldedDescription.search(/\b(nice to have|preferred|souhaite|apprecie|appreciee|un plus|atouts?|bonus|serait un plus)\b/);
  const mainText = requiredHeader > 200 ? foldedDescription.slice(0, requiredHeader) : foldedDescription; const optionalText = requiredHeader > 200 ? foldedDescription.slice(requiredHeader) : "";
  const wanted = new Map<string, { label: string; weight: number; family?: string }>();
  for (const skill of skillAliasMatches(`${foldedTitle} ${fold(job.skillsRequired.join(" "))} ${mainText}`)) wanted.set(skill.id, { label: skill.label, weight: hasTerm(foldedTitle, skill.label) || skill.aliases.some(alias => hasTerm(foldedTitle, alias)) ? 1.5 : 1, family: skill.family });
  for (const skill of skillAliasMatches(optionalText)) if (!wanted.has(skill.id)) wanted.set(skill.id, { label: skill.label, weight: 0.4, family: skill.family });
  for (const item of job.skillsRequired) { const direct = skillIndex.get(fold(item)); if (!direct && fold(item)) wanted.set(`custom:${fold(item)}`, { label: item, weight: 1 }); }
  for (const skill of mine) if (skill.id.startsWith("custom:") && hasTerm(foldedText, skill.label) && !wanted.has(skill.id)) wanted.set(skill.id, { label: skill.label, weight: 1 });
  const matchedSkills: MatchResult["matchedSkills"] = [], missingSkills: string[] = [], transferable: string[] = [];
  let earned = 0, possible = 0;
  for (const [id, want] of wanted) {
    possible += want.weight; const owned = mine.find(skill => skill.id === id);
    if (owned) { earned += want.weight * (owned.core ? 1.15 : 1); matchedSkills.push({ skill: want.label, evidence: owned.evidence }); continue; }
    // SQL is implied by any specific SQL dialect the candidate lists.
    const family = want.family ? mine.find(skill => skill.family === want.family) : undefined;
    if (family) { earned += want.weight * 0.45; transferable.push(`${family.label} (${family.evidence}) is related to ${want.label}`); missingSkills.push(want.label); } else missingSkills.push(want.label);
  }
  if (!possible) { skillsC.score = skillsC.max * 0.4; skillsC.uncertain.push("No recognisable technical requirements in the posting."); }
  else {
    skillsC.score = skillsC.max * clamp(earned / possible, 0, 1);
    skillsC.evidence.push(...matchedSkills.slice(0, 8).map(item => `${item.skill} — ${item.evidence}`));
    if (missingSkills.length) skillsC.gaps.push(`Not evidenced in your profile: ${missingSkills.slice(0, 8).join(", ")}.`);
    if (transferable.length) skillsC.evidence.push(...transferable.slice(0, 4));
  }
  if (!mine.length) { skillsC.uncertain.push("Your profile lists no skills yet; add reviewed skills for accurate scoring."); }

  // 3. Experience / seniority
  const expC = component("experience", "Experience & seniority", 10);
  let seniorityCeiling = 100; const years = candidate.yearsExperience; const known = years > 0; const need = requiredYears(job); const level = jobLevel(foldedTitle, foldedDescription);
  const interestInEntry = candidate.contractTypes.some(type => ["internship", "apprenticeship"].includes(contractKind(type) ?? ""));
  if (level === -1 && !interestInEntry) { blockers.push("Internship or apprenticeship, which your profile does not seek"); expC.gaps.push("Internship / apprenticeship position."); }
  if (!known) { expC.score = expC.max * 0.5; expC.uncertain.push("Years of experience are not set in your profile."); if (need !== null) expC.uncertain.push(`Posting asks for about ${need}+ years.`); }
  else if (need !== null) {
    const gap = need - years; expC.score = expC.max * (gap <= 0 ? 1 : gap <= 1 ? 0.75 : gap <= 2 ? 0.45 : 0.15);
    if (gap <= 0) expC.evidence.push(`${years} years of experience meets the ${need}+ requested.`); else expC.gaps.push(`Posting asks for ${need}+ years; your profile states ${years}.`);
  } else {
    const diff = level - candidateLevel(years); if (diff >= 2) { expC.gaps.push("The role is two or more seniority levels above your stated experience."); seniorityCeiling = 60; } expC.score = expC.max * (level === -1 ? 0.2 : diff === 0 ? 1 : diff < 0 ? 0.8 : diff === 1 ? 0.6 : 0.25);
    if (diff === 0) expC.evidence.push("Seniority looks consistent with your experience."); else if (diff > 0) expC.gaps.push("Posting looks more senior than your stated experience."); else expC.uncertain.push("Posting may be more junior than your experience.");
    expC.uncertain.push("No explicit experience requirement was found.");
  }

  // 4. Location / work style
  const locC = component("location", "Location & work style", 20);
  const style = inferRemote(job, foldedText);
  const prefTexts = [...candidate.locations, ...profiles.flatMap(profile => profile.locations)];
  const prefPlaces = unique(prefTexts.map(value => resolvePlace(fold(value))).filter((place): place is Place => Boolean(place)));
  const prefAreas = unique(prefTexts.flatMap(value => areasIn(fold(value))));
  const wantsEurope = prefTexts.some(value => /\b(europe|emea|eu)\b/.test(fold(value))); const wantsFranceRemote = prefTexts.some(value => /\bremote\b|teletravail|distance/.test(fold(value)) && /\bfrance\b/.test(fold(value)));
  const maxCommute = candidate.maxCommuteKm ?? 70;
  const jobPlace = resolvePlace(foldedLocation); const jobAreas = areasIn(foldedLocation);
  const outsideEurope = nonEuropeWords.some(word => hasTerm(foldedLocation, word));
  const styleNote = style.inferred ? " (inferred from the description)" : "";
  if (style.type === "REMOTE") {
    if (!candidate.remote) { locC.score = 4; locC.gaps.push("Fully remote role, but remote work is not enabled in your profile."); }
    else if (outsideEurope) { locC.score = 0; blockers.push("Remote role restricted to a region outside Europe"); locC.gaps.push(`Remote location "${job.location}" is outside Europe.`); }
    else if (jobPlace?.country === "FR" || (!jobPlace && (hasTerm(foldedLocation, "france") || jobAreas.includes("grand-est")))) { locC.score = 20; locC.evidence.push(`Fully remote role in France${styleNote}.`); }
    else if (jobPlace) { locC.score = wantsEurope ? 15 : 10; locC.uncertain.push(`Remote role based in ${jobPlace.name}; confirm you can work for a ${jobPlace.country} employer remotely.`); }
    else if (europeanCountryWords.some(word => hasTerm(foldedLocation, word))) { locC.score = wantsFranceRemote && !wantsEurope ? 13 : 18; locC.evidence.push(`Remote role open across Europe${styleNote}.`); locC.uncertain.push("Check that the employer can hire you from France."); }
    else { locC.score = 14; locC.uncertain.push(`Remote region is unclear ("${job.location || "not stated"}").`); }
  } else if (jobPlace || jobAreas.length) {
    if (!prefPlaces.length && !prefAreas.length) { locC.score = 12; locC.uncertain.push("No preferred locations in your profile."); }
    else if (jobPlace && prefPlaces.length) {
      const nearest = prefPlaces.map(place => ({ place, km: distanceKm(jobPlace, place) })).sort((a, b) => a.km - b.km)[0]!;
      const km = Math.round(nearest.km);
      locC.score = locC.max * (km <= 15 ? 1 : km <= 35 ? 0.9 : km <= maxCommute ? 0.72 : km <= maxCommute * 1.6 ? 0.38 : 0.1);
      const home = resolvePlace(fold(candidate.location))?.country ?? "FR"; const border = jobPlace.country !== home ? " (cross-border)" : "";
      if (km <= maxCommute) locC.evidence.push(`${jobPlace.name} is about ${km} km from your preferred ${nearest.place.name}${border}.`);
      else {
        locC.gaps.push(`${jobPlace.name} is about ${km} km from ${nearest.place.name}, beyond your ${maxCommute} km limit${border}.`);
        if ((style.type !== "HYBRID" || km > maxCommute * 1.6) && !candidate.relocation) blockers.push(`On-site location ${jobPlace.name} is outside your commute range`); // hybrid still needs regular presence, so only remote roles ignore distance
        else if (candidate.relocation) locC.score = Math.max(locC.score, locC.max * 0.5);
      }
      if (style.type === "HYBRID" && !candidate.hybrid) { locC.score -= 3; locC.gaps.push("Hybrid work is not enabled in your profile."); }
      if ((style.type === "ONSITE" || style.type === "UNKNOWN") && !candidate.onsite && !candidate.hybrid) { locC.score -= 5; locC.gaps.push("On-site work is not enabled in your profile."); }
      if (style.type === "UNKNOWN") locC.uncertain.push("Work style (on-site / hybrid / remote) is not stated.");
      if (style.type === "ONSITE" && candidate.onsite) locC.evidence.push("On-site work matches your preference.");
    } else if (jobAreas.some(area => prefAreas.includes(area) || prefPlaces.some(place => place.area === area))) { locC.score = 15; locC.evidence.push(`Location "${job.location}" is in a region you selected.`); locC.uncertain.push("Only the region is stated, not the city."); }
    else { locC.score = 6; locC.gaps.push(`Location "${job.location}" is outside your preferred areas.`); }
  } else if (hasTerm(foldedLocation, "france") || !foldedLocation) { locC.score = 9; locC.uncertain.push("Only the country is stated, so the commute cannot be assessed."); if (style.type === "HYBRID") locC.score = 11; }
  else { locC.score = prefTexts.some(value => hasTerm(foldedLocation, value)) ? 18 : 5; if (locC.score < 10) locC.gaps.push(`Location "${job.location}" is not one of your preferred locations.`); else locC.evidence.push(`Location matches "${job.location}".`); if (outsideEurope) { blockers.push("Location is outside Europe"); locC.score = 0; } }
  locC.score = clamp(locC.score, 0, locC.max);

  // 5. Language & work authorization
  const langC = component("language", "Language & authorization", 5);
  const mineLanguages = new Set(candidate.languages.flatMap(languageOf)); const demands = languageDemands(foldedDescription); const written = writtenLanguage(foldedDescription);
  langC.score = candidate.languages.length ? 5 : 3;
  if (!candidate.languages.length) langC.uncertain.push("No languages are stored in your profile.");
  else {
    const must = new Set(demands.strong); if (written === "german" || written === "dutch") must.add(written);
    for (const language of must) {
      if (mineLanguages.has(language)) langC.evidence.push(`${language[0]!.toUpperCase()}${language.slice(1)} is listed in your profile.`);
      else if (language === "english") { langC.score -= 1.5; langC.gaps.push("English is required but not listed in your profile."); }
      else { langC.score -= 5; langC.gaps.push(`${language[0]!.toUpperCase()}${language.slice(1)} appears required but is not listed in your profile.`); blockers.push(`Requires ${language} (not in your profile)`); }
    }
    for (const language of demands.weak) if (!mineLanguages.has(language) && !must.has(language)) { langC.score -= 0.5; langC.uncertain.push(`${language[0]!.toUpperCase()}${language.slice(1)} is a plus, not required.`); }
  }
  if (/(authori[sz]ed to work|work permit|permis de travail|right to work|eligible to work|autorisation de travail|ressortissant|citoyen europeen|visa sponsorship)/.test(foldedText)) {
    if (candidate.workAuthorization) langC.uncertain.push(`The posting mentions work authorization; your stored status is "${candidate.workAuthorization}". Verify it is accepted.`);
    else { langC.uncertain.push("The posting mentions work authorization, but none is stored in your profile."); langC.score -= 1; }
  }
  langC.score = clamp(langC.score, 0, langC.max);

  // 6. Salary
  const salC = component("salary", "Salary", 5);
  const minimum = candidate.minimumSalary ?? profiles.map(profile => profile.salaryMin).find((value): value is number => typeof value === "number") ?? null;
  const plausible = (value: number | null) => value !== null && value >= 1_000;
  if (!plausible(job.salaryMin) && !plausible(job.salaryMax)) { salC.score = salC.max * 0.5; salC.uncertain.push("Salary is not stated."); }
  else if (minimum === null) { salC.score = salC.max * 0.7; salC.evidence.push("Salary is stated; no minimum is set in your profile."); }
  else if (plausible(job.salaryMax) && job.salaryMax! < minimum) { salC.score = 0; blockers.push("Maximum stated salary is below the candidate minimum"); salC.gaps.push(`Posting tops out at ${job.salaryMax} ${job.salaryCurrency}, below your minimum of ${minimum}.`); }
  else if (plausible(job.salaryMax) && job.salaryMax! >= minimum) { salC.score = salC.max; salC.evidence.push(`Salary range reaches ${job.salaryMax} ${job.salaryCurrency}, above your minimum of ${minimum}.`); }
  else { salC.score = salC.max * 0.6; salC.uncertain.push("Only a lower salary bound is stated."); }

  // 7. Contract
  const conC = component("contract", "Contract type", 5);
  const jobContract = contractKind(`${job.contractType} ${job.title}`) ?? contractKind(foldedDescription.slice(0, 600));
  const wantedContracts = unique([...candidate.contractTypes, ...profiles.flatMap(profile => profile.contractTypes)].map(value => contractKind(value)).filter((value): value is NonNullable<ReturnType<typeof contractKind>> => Boolean(value)));
  if (!wantedContracts.length) { conC.score = conC.max * 0.6; if (jobContract) conC.evidence.push(`Contract: ${jobContract}.`); else conC.uncertain.push("Contract type is not stated."); }
  else if (!jobContract) { conC.score = conC.max * 0.5; conC.uncertain.push("Contract type is not stated in the posting."); }
  else if (wantedContracts.includes(jobContract)) { conC.score = conC.max; conC.evidence.push(`Contract type ${jobContract} matches your preference.`); }
  else { conC.score = 0; conC.gaps.push(`Contract looks ${jobContract}; you prefer ${wantedContracts.join(", ")}.`); }

  // 8. Search-profile keywords (interest signal only, never evidence of ability)
  const keyC = component("keywords", "Search keywords", 3);
  const keywords = unique(profiles.flatMap(profile => profile.keywords).map(value => value.trim()).filter(Boolean));
  const keywordHits = keywords.filter(keyword => hasTerm(foldedText, keyword));
  if (!keywords.length) { keyC.score = keyC.max * 0.5; }
  else { keyC.score = keyC.max * clamp(keywordHits.length / Math.min(keywords.length, 3), 0, 1); if (keywordHits.length) keyC.evidence.push(`Mentions your search keywords: ${keywordHits.slice(0, 5).join(", ")}.`); else keyC.gaps.push("None of your search keywords appear in the posting."); }

  const raw = components.reduce((sum, item) => sum + item.score, 0);
  const uniqueBlockers = unique(blockers);
  let score = Math.round(clamp(raw, 0, 100));
  score = Math.min(score, seniorityCeiling);
  if (uniqueBlockers.length) score = Math.min(score, 35);
  for (const item of components) { item.score = round1(item.score); globalUncertain.push(...item.uncertain); }
  const withEvidence = components.filter(item => item.evidence.length > 0).length;
  const confidence = round1(clamp(withEvidence / components.length - globalUncertain.length * 0.02, 0.1, 1));
  const strongest = [...components].sort((a, b) => b.score / b.max - a.score / a.max)[0]!;
  const weakest = [...components].sort((a, b) => a.score / a.max - b.score / b.max)[0]!;
  const summary = uniqueBlockers.length ? `Capped by blocker: ${uniqueBlockers[0]}.` : `Strongest area: ${strongest.label.toLowerCase()}; weakest: ${weakest.label.toLowerCase()}.`;
  return { engineVersion: MATCH_ENGINE_VERSION, score, label: labelFor(score), confidence, components, matchedSkills, missingSkills, transferableSkills: transferable, blockers: uniqueBlockers, uncertain: unique(globalUncertain), summary };
}
