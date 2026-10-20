import * as cheerio from "cheerio";
import { normalizedJobSchema, type NormalizedJob } from "@/lib/schemas";
import { fold } from "@/matching/score";
import { countryFrom, helloworkUrl, indeedUrl, linkedinUrl, remoteFrom, salaryFromText, unknownEmployer, wttjReference, type PortalId } from "@/providers/portals";

/**
 * Parses the job-alert emails that LinkedIn, Indeed, HelloWork and Welcome to the Jungle send to the owner. Pure functions:
 * the mailbox access and the optional click-tracking resolution live in providers/email-alerts.ts.
 * Formats verified against real alerts (October 2026): LinkedIn's plain-text part, HelloWork's HTML with the destination
 * embedded in its tracking links. Indeed and Welcome to the Jungle use the same card reading on resolved links.
 */
export type AlertMessage = { from: string; subject: string; date: Date; text: string; html: string };
export type JobRef = { portal: PortalId; id: string; url: string };
export type AlertJob = JobRef & { title: string; company: string; location: string; contract: string; salary: string };
type Line = { text: string; links: { href: string; text: string }[] };
type DomNode = { type: string; data?: string; name?: string; attribs?: Record<string, string>; children?: DomNode[] };

export const portalNames: Record<PortalId, string> = { linkedin: "LinkedIn", indeed: "Indeed", hellowork: "HelloWork", wttj: "Welcome to the Jungle" };
/** IMAP FROM search terms; every match is still checked with `alertPortal`. */
export const alertSenderTerms = ["linkedin.com", "indeed.com", "hellowork.com", "welcometothejungle.com"];
/**
 * Hosts whose redirect may be read to find a posting behind a click-tracking link. LinkedIn links are direct and HelloWork's
 * carry their destination, so neither is ever requested.
 */
export const trackingHosts = ["sendgrid.net", "indeed.com", "welcometothejungle.com"];

/** The portal that sent a job alert, or null for anything else (messages, application receipts, security notices). */
export function alertPortal(address: string): PortalId | null {
  const value = address.trim().toLowerCase();
  if (/^(jobs-noreply|jobalerts-noreply|jobs-listings)@linkedin\.com$/.test(value)) return "linkedin";
  if (/@emails\.hellowork\.com$/.test(value)) return "hellowork";
  if (/@(?:[a-z0-9-]+\.)*indeed\.com$/.test(value) && !/^(indeedapply|safety-notifications|security|account|messages|no-reply-support)/.test(value)) return "indeed";
  if (/@(?:[a-z0-9-]+\.)*welcometothejungle\.com$/.test(value)) return "wttj";
  return null;
}

/** Recognises a portal posting URL and returns its canonical identity (the same one the Apify sources produce). */
export function jobRef(raw: string): JobRef | null {
  let url: URL; try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (/(^|\.)linkedin\.com$/.test(host)) { const id = url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})(?:\/|$)/)?.[1]; return id ? { portal: "linkedin", id, url: linkedinUrl(id) } : null; }
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) { const key = (url.searchParams.get("jk") ?? url.searchParams.get("vjk") ?? "").toLowerCase(); return /^[0-9a-f]{16}$/.test(key) ? { portal: "indeed", id: key, url: indeedUrl(host.replace(/^www\./, ""), key) } : null; }
  if (/(^|\.)hellowork\.com$/.test(host)) { const id = url.pathname.match(/\/emplois\/(\d+)\.html$/)?.[1]; return id ? { portal: "hellowork", id, url: helloworkUrl(id) } : null; }
  if (/(^|\.)welcometothejungle\.com$/.test(host)) { const reference = wttjReference(url.toString()); return reference ? { portal: "wttj", ...reference } : null; }
  return null;
}

/** Unwraps tracking links whose destination is carried in the link itself, so no request is needed. */
export function embeddedTarget(href: string): string {
  if (jobRef(href)) return href;
  let url: URL; try { url = new URL(href); } catch { return href; }
  // HelloWork: emails.hellowork.com/clic/<campaign>/<n>/<hash>/<base64url(recipient, separator, destination)>
  if (/(^|\.)emails\.hellowork\.com$/.test(url.hostname) && url.pathname.startsWith("/clic/")) {
    const decoded = Buffer.from(url.pathname.split("/").pop() ?? "", "base64url").toString("utf8"); const start = decoded.indexOf("https://");
    if (start >= 0) return decoded.slice(start);
  }
  for (const value of url.searchParams.values()) if (/^https?:\/\//i.test(value)) return value;
  return href;
}

const blockTags = new Set(["p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "tbody", "thead", "section", "article", "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "br", "center", "blockquote"]);
/** Email HTML as reading-order lines, each with the links it contains. Anchors are kept whole even when they wrap blocks. */
export function htmlLines(html: string): Line[] {
  const $ = cheerio.load(html); $("head,style,script,noscript,title").remove();
  const lines: Line[] = []; let current: Line = { text: "", links: [] };
  const flush = () => { const text = current.text.replace(/[\s ‌͏]+/g, " ").trim(); if (text || current.links.length) lines.push({ text, links: current.links }); current = { text: "", links: [] }; };
  const textOf = (node: DomNode): string => node.type === "text" ? node.data ?? "" : (node.children ?? []).map(textOf).join(" ");
  const walk = (node: DomNode, inAnchor: boolean) => {
    if (node.type === "text") { current.text += node.data ?? ""; return; }
    if (node.type !== "tag" || !node.name) return;
    const name = node.name.toLowerCase(); const block = blockTags.has(name) && !inAnchor;
    if (block) flush();
    if (name === "a" && !inAnchor) {
      const href = node.attribs?.href?.trim() ?? "";
      if (/^https?:\/\//i.test(href)) current.links.push({ href, text: textOf(node).replace(/\s+/g, " ").trim() });
      for (const child of node.children ?? []) walk(child, true);
    } else for (const child of node.children ?? []) walk(child, inAnchor);
    if (block) flush();
  };
  for (const node of ($.root()[0] as unknown as DomNode).children ?? []) walk(node, false);
  flush();
  return lines;
}

const genericLink = /^(voir l['’]offre( d['’]emploi)?|view job|see job|apply( now)?|postuler|candidater|en savoir plus|decouvrir l['’]offre|voir le poste|see more)$/;
const noise = /^(apply with resume|candidature simplifiee|easy apply|actively recruiting|recrutement actif|be an early applicant|soyez parmi les premiers|promoted|promu|nouveau|new|il y a|publie|posted|\d+ (connections?|relations?|anciens?|alumni|candidat))/;
const footer = /^(voir toutes les offres|view all jobs|see all jobs|toutes les offres|manage (alerts|recommendations)|gerer (mes|vos) alertes|unsubscribe|se desabonner|vous recevez|you are receiving)/;
const contractWords = /^(cdi|cdd|interim|alternance|stage|freelance|independant|temps plein|temps partiel|full-time|part-time|contract|permanent|internship|apprentissage|vie)\b/;
const looksLikeSalary = (line: string) => /€|\beur\b|k€|\$|£/i.test(line) && /\d/.test(line);

/** Splits the lines under a title into company, place, contract and salary; the first plain line is the employer, the next the place. */
function details(lines: string[]) {
  let contract = "", salary = ""; const plain: string[] = [];
  for (const line of lines) {
    const folded = fold(line);
    if (!line || noise.test(folded)) continue;
    if (!salary && looksLikeSalary(line)) { salary = line; continue; }
    if (!contract && contractWords.test(folded)) { contract = line; continue; }
    plain.push(line);
  }
  const first = plain[0] ?? "";
  if (first.includes(" · ")) { const [company, ...place] = first.split(" · "); return { company: company!.trim(), location: place.join(" · ").trim() || (plain[1] ?? ""), contract, salary }; }
  return { company: first, location: plain[1] ?? "", contract, salary };
}

/** Plain-text alerts: a posting is the paragraph (title, company, place, extras) directly above a line carrying its URL. */
export function cardsFromText(text: string, resolve: (href: string) => string = embeddedTarget): AlertJob[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()); const jobs = new Map<string, AlertJob>();
  lines.forEach((line, index) => {
    const href = line.match(/https?:\/\/[^\s<>()]+/)?.[0]; const ref = href ? jobRef(resolve(href)) : null;
    if (!ref || jobs.has(ref.url)) return;
    const block: string[] = [];
    for (let back = index - 1; back >= 0 && lines[back] && !/^[-–_=]{5,}$/.test(lines[back]!); back--) block.unshift(lines[back]!);
    const fields = block.filter(field => !/https?:\/\//.test(field)); if (!fields[0] || genericLink.test(fold(fields[0]))) return;
    jobs.set(ref.url, { ...ref, title: fields[0], ...details(fields.slice(1)) });
  });
  return [...jobs.values()];
}

/** HTML alerts: a posting starts at the first line linking to it with a title, and its details run until the next posting or its own call to action. */
export function cardsFromLines(lines: Line[], resolve: (href: string) => string = embeddedTarget): AlertJob[] {
  const annotated = lines.map(line => ({ ...line, refs: line.links.flatMap(link => { const ref = jobRef(resolve(link.href)); return ref ? [{ ref, text: link.text }] : []; }) }));
  const jobs = new Map<string, AlertJob>();
  annotated.forEach((line, index) => {
    const found = line.refs[0]; if (!found || jobs.has(found.ref.url)) return;
    const title = [line.text, found.text].map(value => value.trim()).find(value => value && !genericLink.test(fold(value)));
    if (!title) return;
    const below: string[] = [];
    for (let next = index + 1; next < annotated.length && below.length < 8; next++) {
      const candidate = annotated[next]!;
      if (candidate.refs.length || footer.test(fold(candidate.text))) break;
      if (candidate.text) below.push(candidate.text);
    }
    jobs.set(found.ref.url, { ...found.ref, title, ...details(below) });
  });
  return [...jobs.values()];
}

/**
 * Click-tracking links that might hide a posting: anchored text, an opaque destination, a tracking host, and nothing that looks
 * like navigation. Some mailers act on a simple visit (one-click unsubscribe), so account, alert and unsubscribe links are never
 * candidates.
 */
export function trackedLinks(message: AlertMessage): string[] {
  if (!message.html) return [];
  // Phrases are anchored so real titles ("Account Manager", "Technicien Helpdesk", "Développeur d'applications") stay candidates.
  const skip = /unsub|desabonn|desinscri|opt.?out|preferen|parametres|settings|(gerer|modifier|manage|edit) (mes |vos |cette |this |l'|les |your |job )*alertes?|manage alerts?|mon compte|my account|votre compte|your account|^(facebook|instagram|youtube|twitter|x|tiktok|linkedin)$|^contact$|nous contacter|contact us|contactez|confidentialite|privacy|donnees personnelles|^aide$|^help$|help center|centre d'aide|^cgu$|mentions legales|notre appli|our app|telecharg|download|mon profil|my profile|votre profil|your profile|update my status|espace candidat|candidate space|voir toutes|see all|view all|toutes les offres|why we included/;
  const links = htmlLines(message.html).flatMap(line => line.links).filter(link => link.text.length >= 3 && link.text.length <= 140 && !skip.test(fold(link.text)) && embeddedTarget(link.href) === link.href && !jobRef(link.href));
  return [...new Set(links.map(link => link.href))].filter(href => { try { const host = new URL(href).hostname; return trackingHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`)); } catch { return false; } });
}

/** All postings in one alert email. `resolved` maps tracking links to destinations already looked up by the caller. */
export function parseAlertEmail(message: AlertMessage, resolved: Map<string, string> = new Map()): { portal: PortalId | null; jobs: AlertJob[] } {
  const portal = alertPortal(message.from); if (!portal) return { portal, jobs: [] };
  const resolve = (href: string) => resolved.get(href) ?? embeddedTarget(href);
  let jobs = portal === "linkedin" && message.text ? cardsFromText(message.text, resolve) : [];
  if (!jobs.length && message.html) jobs = cardsFromLines(htmlLines(message.html), resolve);
  if (!jobs.length && message.text) jobs = cardsFromText(message.text, resolve);
  return { portal, jobs };
}

/**
 * An alert lists title, employer, place and sometimes contract and salary, never the full description. The summary says so,
 * and the publication date stays unknown: the email's date is when the alert was sent, not when the job was posted.
 */
export function alertToJob(job: AlertJob, receivedAt: Date): NormalizedJob {
  const summary = [`Listed in your ${portalNames[job.portal]} job alert of ${receivedAt.toISOString().slice(0, 10)}.`, job.contract && `Contract: ${job.contract}.`, job.salary && `Salary: ${job.salary}.`, "Open the posting for the full description."].filter(Boolean).join(" ");
  return normalizedJobSchema.parse({ source: job.portal, sourceJobId: job.id, sourceUrl: job.url, companyName: job.company.slice(0, 300) || unknownEmployer, title: job.title.slice(0, 300), location: job.location.slice(0, 300) || "France", country: countryFrom(job.location), remoteType: remoteFrom(`${job.location} ${job.title}`), contractType: job.contract.slice(0, 100) || "UNKNOWN", ...salaryFromText(job.salary), descriptionRaw: summary, descriptionClean: summary, extractor: `email_alert:${job.portal}`, sourceMetadata: { alertReceivedAt: receivedAt.toISOString() } });
}
