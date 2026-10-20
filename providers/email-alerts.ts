import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "@/lib/config";
import type { NormalizedJob } from "@/lib/schemas";
import { alertPortal, alertSenderTerms, alertToJob, jobRef, parseAlertEmail, portalNames, trackedLinks, trackingHosts, type AlertMessage } from "@/providers/alerts";
import { redirectTarget } from "@/providers/core";
import { ProviderError, type JobProvider, type ProviderHealth, type ProviderSearchResult, type SearchRequest } from "@/providers/types";

export type MailSource = { messagesSince(since: Date, limit: number): Promise<{ messages: AlertMessage[]; mailbox: string }> };
const MAX_MESSAGES = 120, MAX_RESOLUTIONS_PER_RUN = 80, MAX_RESOLUTIONS_PER_EMAIL = 25;

/** Reads job-alert emails from an IMAP mailbox, read-only: messages are never flagged, moved or deleted. */
export function imapSource(imapUrl: string): MailSource {
  const url = new URL(imapUrl); const secure = url.protocol === "imaps:"; const mailbox = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "INBOX";
  return {
    async messagesSince(since, limit) {
      const client = new ImapFlow({ host: url.hostname, port: Number(url.port) || (secure ? 993 : 143), secure, auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }, logger: false, socketTimeout: 60_000, disableAutoIdle: true });
      try { await client.connect(); }
      catch (error) {
        const message = (error as Error).message; const auth = /auth|login|credential|password|invalid/i.test(message) || (error as { authenticationFailed?: boolean }).authenticationFailed;
        throw new ProviderError(auth ? "AUTH" : "NETWORK", auth ? `The mailbox rejected the login for ${decodeURIComponent(url.username)} (for Gmail, use an app password).` : `Could not reach ${url.hostname}: ${message}`, !auth);
      }
      try {
        try { await client.mailboxOpen(mailbox, { readOnly: true }); } catch { throw new ProviderError("NOT_FOUND", `The mailbox folder "${mailbox}" does not exist.`, false); }
        const uids = new Set<number>();
        for (const term of alertSenderTerms) { const found = await client.search({ since, from: term }, { uid: true }); for (const uid of found || []) uids.add(uid); }
        const recent = [...uids].sort((a, b) => b - a).slice(0, limit * 4); const wanted: number[] = [];
        if (recent.length) for await (const message of client.fetch(recent, { uid: true, envelope: true }, { uid: true })) if (alertPortal(message.envelope?.from?.[0]?.address ?? "")) wanted.push(message.uid);
        const selected = wanted.sort((a, b) => b - a).slice(0, limit); const messages: AlertMessage[] = [];
        if (selected.length) for await (const message of client.fetch(selected, { uid: true, source: true, internalDate: true }, { uid: true })) {
          if (!message.source) continue; const parsed = await simpleParser(message.source);
          messages.push({ from: parsed.from?.value[0]?.address ?? "", subject: parsed.subject ?? "", date: parsed.date ?? new Date(message.internalDate ?? Date.now()), text: parsed.text ?? "", html: typeof parsed.html === "string" ? parsed.html : "" });
        }
        return { messages, mailbox: `${url.hostname}/${mailbox}` };
      } finally { await client.logout().catch(() => client.close()); }
    }
  };
}

/**
 * Imports the postings listed in job-alert emails the owner receives from LinkedIn, Indeed, HelloWork and Welcome to the Jungle.
 * Nothing is fetched from the portals: links that hide their destination behind click tracking are resolved by reading the
 * redirect header only. Postings are saved under the portal's own identity, so a richer copy found elsewhere merges with them.
 */
export class EmailAlertsProvider implements JobProvider {
  id = "email_alerts";
  constructor(private source?: MailSource, private resolve: (url: string) => Promise<string | null> = url => redirectTarget(url, trackingHosts)) {}
  private mail() {
    if (this.source) return this.source;
    const url = config().IMAP_URL; if (!url) throw new ProviderError("AUTH", "IMAP_URL is not configured; set it to the mailbox that receives your job alerts (for Gmail: imaps://you%40gmail.com:APP-PASSWORD@imap.gmail.com:993/INBOX).", false);
    return imapSource(url);
  }
  normalize(raw: unknown): NormalizedJob { const { job, receivedAt } = raw as { job: Parameters<typeof alertToJob>[0]; receivedAt: Date }; return alertToJob(job, receivedAt); }
  /** Follows up to three tracking redirects until a posting URL appears. */
  private async follow(href: string) {
    let current = href;
    for (let hop = 0; hop < 3; hop++) { const next = await this.resolve(current); if (!next) return hop ? current : null; if (jobRef(next)) return next; current = next; }
    return current;
  }
  async search(request: SearchRequest): Promise<ProviderSearchResult> {
    const days = Math.min(Math.max(request.datePostedWindow, 1), 14);
    const { messages } = await this.mail().messagesSince(new Date(Date.now() - days * 86_400_000), MAX_MESSAGES);
    const jobs = new Map<string, NormalizedJob>(); const warnings: string[] = []; let fetched = 0, invalid = 0, resolutions = 0;
    for (const message of [...messages].sort((a, b) => b.date.getTime() - a.date.getTime())) {
      let parsed = parseAlertEmail(message);
      const tracked = parsed.portal ? trackedLinks(message).slice(0, MAX_RESOLUTIONS_PER_EMAIL) : [];
      if (tracked.length && resolutions < MAX_RESOLUTIONS_PER_RUN) {
        const resolved = new Map<string, string>();
        for (const href of tracked) { if (resolutions++ >= MAX_RESOLUTIONS_PER_RUN) break; const target = await this.follow(href); if (target) resolved.set(href, target); }
        if (resolved.size) parsed = parseAlertEmail(message, resolved);
      }
      for (const job of parsed.jobs) { fetched++; if (jobs.has(job.url)) continue; try { jobs.set(job.url, alertToJob(job, message.date)); } catch { invalid++; } }
    }
    if (!messages.length) warnings.push(`No job-alert emails from ${Object.values(portalNames).join(", ")} in the last ${days} days. Create alerts on those sites for this mailbox's address.`);
    else if (!fetched) warnings.push(`${messages.length} job-alert emails were found but no posting could be read from them; their format may have changed.`);
    const list = [...jobs.values()].slice(0, request.maxJobs);
    return { jobs: list, stats: { fetched, valid: list.length, invalid }, warnings };
  }
  async fetchDetails(): Promise<NormalizedJob> { throw new ProviderError("NOT_FOUND", "Job-alert postings are read from emails during a search run.", false); }
  /** Connects, counts the alert emails of the last 14 days per portal and the postings readable without following any link. */
  async healthCheck(): Promise<ProviderHealth> {
    try {
      const { messages, mailbox } = await this.mail().messagesSince(new Date(Date.now() - 14 * 86_400_000), MAX_MESSAGES);
      const counts = new Map<string, { emails: number; postings: number }>();
      for (const message of messages) { const parsed = parseAlertEmail(message); if (!parsed.portal) continue; const entry = counts.get(parsed.portal) ?? { emails: 0, postings: 0 }; entry.emails++; entry.postings += parsed.jobs.length; counts.set(parsed.portal, entry); }
      const summary = Object.entries(portalNames).map(([id, name]) => { const entry = counts.get(id); return `${name}: ${entry ? `${entry.emails} emails, ${entry.postings} postings` : "none"}`; }).join("; ");
      return { status: messages.length ? "HEALTHY" : "DEGRADED", detail: `Connected to ${mailbox} (read-only). Job alerts in the last 14 days: ${summary}.${messages.length ? "" : " Create job alerts on those sites for this address."}` };
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "UNKNOWN";
      return { status: code === "AUTH" || code === "NOT_FOUND" ? "FAILED" : "DEGRADED", detail: (error as Error).message };
    }
  }
}
