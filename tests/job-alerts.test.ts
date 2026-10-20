import { EventEmitter } from "node:events";
import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";
import { alertPortal, alertToJob, embeddedTarget, jobRef, parseAlertEmail, trackedLinks, type AlertMessage } from "@/providers/alerts";
import { EmailAlertsProvider, imapSettings, imapSource, loginFailure, type MailSource } from "@/providers/email-alerts";
import type { SearchRequest } from "@/providers/types";

// Fixtures reproduce the structure of real alerts (October 2026) with invented companies, IDs and recipient.
const linkedinText = `Expand your search

Recommendations based on your activity.

Azure jobs
https://www.linkedin.com/comm/jobs/search-results/?keywords=ETL+Developer&originToLandingJobPostings=4467735579,4468183888&trk=eml-x

Data Engineer
Acme Data
France
View job: https://www.linkedin.com/comm/jobs/view/4467735579/?trackingId=abc%3D%3D&refId=def&trk=eml-email_jobs-view_job

---------------------------------------------------------

Data Engineer F/H
Beta Conseil
Strasbourg
Apply with resume & profile
View job: https://www.linkedin.com/comm/jobs/view/4468183888/?trackingId=ghi&trk=eml-view_job

---------------------------------------------------------

View all jobs: https://www.linkedin.com/comm/jobs/search-results/?keywords=ETL+Developer

----------------------------------------

This email was intended for Test Candidate (Data Engineer)
Unsubscribe: https://www.linkedin.com/comm/mypreferences/u/emailunsub?action=updateEmailSubscription`;

const clic = (destination: string) => `https://emails.hellowork.com/clic/d6e4-campaign/3/aff1hash/${Buffer.from(`candidate@example.com\u{1FAA2}${destination}`).toString("base64url")}`;
const helloworkHtml = `<html><head><style>td{color:red}</style></head><body><table>
<tr><td>Hello Candidate !</td></tr><tr><td>2 nouvelles missions d'intérim correspondent à votre profil.</td></tr>
<tr><td>Analyste de Donnees H/F <a href="${clic("https://www.hellowork.com/fr-fr/emplois/83681071.html?utm_source=pushOffres&utm_content=liste1title")}"><img src="arrow.png"></a></td></tr>
<tr><td>Delta Industrie</td></tr><tr><td>Metz - 57</td></tr><tr><td>Intérim</td></tr><tr><td>17,06 € / heure</td></tr>
<tr><td><a href="${clic("https://www.hellowork.com/fr-fr/emplois/83681071.html?utm_content=liste1CTA")}">Voir l’offre</a></td></tr>
<tr><td>Acheteur Voyages et Communication H/F <a href="${clic("https://www.hellowork.com/fr-fr/emplois/83391514.html?utm_content=liste1title")}"></a></td></tr>
<tr><td>Groupe Exemple</td></tr><tr><td>Le Plessis-Robinson - 92</td></tr><tr><td>CDI</td></tr><tr><td>44 000 - 52 000 € / an</td></tr>
<tr><td><a href="${clic("https://www.hellowork.com/fr-fr/emplois/83391514.html?utm_content=liste1CTA")}">Voir l’offre</a></td></tr>
<tr><td><a href="${clic("https://www.hellowork.com/fr-fr/candidat/mon-espace/offres.html")}">Voir toutes les offres</a></td></tr>
<tr><td><a href="${clic("https://www.instagram.com/hellowork_/")}">Instagram</a> <a href="${clic("https://www.hellowork.com/fr-fr/r/1/desabonnement")}">vous désabonner</a></td></tr>
</table></body></html>`;

const sendgrid = (token: string) => `https://u1.ct.sendgrid.net/ls/click?upn=u001.${token}`;
const wttjHtml = `<div><h2>New jobs for your alert</h2>
<div><a href="${sendgrid("job-a")}"><div>Data Engineer (H/F)</div></a><p>Theta</p><p>Paris</p><p>CDI</p></div>
<div><a href="${sendgrid("job-b")}">Ingénieur ETL</a><p>Iota · Nancy</p></div>
<p><a href="${sendgrid("unsubscribe-c")}">Unsubscribe</a> <a href="${sendgrid("all-d")}">See all jobs</a></p></div>`;
const wttjTargets = new Map([[sendgrid("job-a"), "https://www.welcometothejungle.com/fr/companies/theta/jobs/data-engineer_paris?utm_source=alert"], [sendgrid("job-b"), "https://www.welcometothejungle.com/en/companies/iota/jobs/ingenieur-etl_nancy"]]);
const indeedHtml = `<table><tr><td><a href="https://fr.indeed.com/rc/clk/dl?jk=0123456789ABCDEF&from=ja">Ingénieur Data H/F</a></td></tr><tr><td>Epsilon</td></tr><tr><td>Nancy (54)</td></tr><tr><td>CDI</td></tr>
<tr><td><a href="https://cts.indeed.com/v3/opaque-token">Développeur ETL</a></td></tr><tr><td>Zeta</td></tr><tr><td>Metz (57)</td></tr></table>`;

const message = (from: string, body: Partial<AlertMessage>): AlertMessage => ({ from, subject: "alert", date: new Date("2026-10-19T13:25:49Z"), text: "", html: "", ...body });
const request: SearchRequest = { queries: [], locations: [], remotePreferences: [], datePostedWindow: 7, maxJobs: 100 };

describe("job-alert senders and links", () => {
  it("accepts alert senders only, never personal messages or receipts", () => {
    expect(alertPortal("jobs-noreply@linkedin.com")).toBe("linkedin");
    expect(alertPortal("messages-noreply@linkedin.com")).toBeNull();
    expect(alertPortal("notification@emails.hellowork.com")).toBe("hellowork");
    expect(alertPortal("r-c-6ad5c5a957f9cf08@reply.hellowork.com")).toBeNull();
    expect(alertPortal("alert@indeed.com")).toBe("indeed");
    expect(alertPortal("indeedapply@indeed.com")).toBeNull();
    expect(alertPortal("no-reply@welcometothejungle.com")).toBe("wttj");
  });
  it("canonicalizes posting links to the identity the Apify sources use", () => {
    expect(jobRef("https://www.linkedin.com/comm/jobs/view/4467735579/?trk=x")).toEqual({ portal: "linkedin", id: "4467735579", url: "https://www.linkedin.com/jobs/view/4467735579/" });
    expect(jobRef("https://fr.linkedin.com/jobs/view/data-engineer-at-acme-4467735579")?.id).toBe("4467735579");
    expect(jobRef("https://fr.indeed.com/rc/clk/dl?jk=0123456789ABCDEF")).toEqual({ portal: "indeed", id: "0123456789abcdef", url: "https://fr.indeed.com/viewjob?jk=0123456789abcdef" });
    expect(jobRef("https://www.linkedin.com/comm/jobs/search-results/?originToLandingJobPostings=4467735579")).toBeNull();
  });
  it("decodes HelloWork tracking links without any request", () => {
    expect(embeddedTarget(clic("https://www.hellowork.com/fr-fr/emplois/83681071.html?utm_source=x"))).toBe("https://www.hellowork.com/fr-fr/emplois/83681071.html?utm_source=x");
  });
});

describe("job-alert parsing", () => {
  it("reads LinkedIn's plain-text alert into title, employer and place", () => {
    const { jobs } = parseAlertEmail(message("jobs-noreply@linkedin.com", { text: linkedinText }));
    expect(jobs).toEqual([
      expect.objectContaining({ id: "4467735579", title: "Data Engineer", company: "Acme Data", location: "France" }),
      expect.objectContaining({ id: "4468183888", title: "Data Engineer F/H", company: "Beta Conseil", location: "Strasbourg" })
    ]);
  });
  it("reads HelloWork cards with contract and salary and ignores footer links", () => {
    const { jobs } = parseAlertEmail(message("notification@emails.hellowork.com", { html: helloworkHtml }));
    expect(jobs).toEqual([
      { portal: "hellowork", id: "83681071", url: "https://www.hellowork.com/fr-fr/emplois/83681071.html", title: "Analyste de Donnees H/F", company: "Delta Industrie", location: "Metz - 57", contract: "Intérim", salary: "17,06 € / heure" },
      { portal: "hellowork", id: "83391514", url: "https://www.hellowork.com/fr-fr/emplois/83391514.html", title: "Acheteur Voyages et Communication H/F", company: "Groupe Exemple", location: "Le Plessis-Robinson - 92", contract: "CDI", salary: "44 000 - 52 000 € / an" }
    ]);
    expect(trackedLinks(message("notification@emails.hellowork.com", { html: helloworkHtml }))).toEqual([]);
  });
  it("only offers job-like tracked links for resolution, never unsubscribe or navigation", () => {
    expect(trackedLinks(message("no-reply@welcometothejungle.com", { html: wttjHtml }))).toEqual([sendgrid("job-a"), sendgrid("job-b")]);
    const { jobs } = parseAlertEmail(message("no-reply@welcometothejungle.com", { html: wttjHtml }), wttjTargets);
    expect(jobs).toEqual([
      expect.objectContaining({ portal: "wttj", id: "theta/data-engineer_paris", title: "Data Engineer (H/F)", company: "Theta", location: "Paris", contract: "CDI" }),
      expect.objectContaining({ portal: "wttj", id: "iota/ingenieur-etl_nancy", title: "Ingénieur ETL", company: "Iota", location: "Nancy" })
    ]);
  });
  it("turns an alert posting into a job without inventing a publication date", () => {
    const [first] = parseAlertEmail(message("notification@emails.hellowork.com", { html: helloworkHtml })).jobs;
    const job = alertToJob({ ...first!, salary: "44 000 - 52 000 € / an" }, new Date("2026-10-19T13:25:49Z"));
    expect(job).toMatchObject({ source: "hellowork", sourceJobId: "83681071", extractor: "email_alert:hellowork", publishedAt: null, salaryMin: 44_000, contractType: "Intérim", sourceMetadata: { alertReceivedAt: "2026-10-19T13:25:49.000Z" } });
    expect(job.descriptionClean).toBe("Listed in your HelloWork job alert of 2026-10-19. Contract: Intérim. Salary: 44 000 - 52 000 € / an. Open the posting for the full description.");
  });
});

describe("job-alert email source", () => {
  const source = (messages: AlertMessage[]): MailSource => ({ messagesSince: vi.fn(async () => ({ messages, mailbox: "imap.example.com/INBOX" })) });
  it("imports postings from every portal, de-duplicates repeats and resolves only tracked job links", async () => {
    const resolve = vi.fn(async (url: string) => wttjTargets.get(url) ?? (url.includes("opaque-token") ? "https://fr.indeed.com/viewjob?jk=fedcba9876543210" : null));
    const provider = new EmailAlertsProvider(source([
      message("jobs-noreply@linkedin.com", { text: linkedinText }),
      message("jobs-noreply@linkedin.com", { text: linkedinText, date: new Date("2026-10-18T10:00:00Z") }),
      message("notification@emails.hellowork.com", { html: helloworkHtml }),
      message("no-reply@welcometothejungle.com", { html: wttjHtml }),
      message("alert@indeed.com", { html: indeedHtml })
    ]), resolve);
    const result = await provider.search(request);
    expect(result.jobs.map(job => `${job.source}:${job.sourceJobId}`).sort()).toEqual(["hellowork:83391514", "hellowork:83681071", "indeed:0123456789abcdef", "indeed:fedcba9876543210", "linkedin:4467735579", "linkedin:4468183888", "wttj:iota/ingenieur-etl_nancy", "wttj:theta/data-engineer_paris"]);
    expect(result.stats).toMatchObject({ fetched: 10, valid: 8, invalid: 0 }); expect(result.warnings).toEqual([]);
    expect(resolve.mock.calls.map(([url]) => url).sort()).toEqual([sendgrid("job-a"), sendgrid("job-b"), "https://cts.indeed.com/v3/opaque-token"].sort());
  });
  it("explains an empty mailbox and an unreadable format", async () => {
    expect((await new EmailAlertsProvider(source([])).search(request)).warnings[0]).toContain("No job-alert emails");
    const unreadable = await new EmailAlertsProvider(source([message("jobs-noreply@linkedin.com", { text: "Your weekly digest is ready." })]), async () => null).search(request);
    expect(unreadable.warnings[0]).toContain("format may have changed");
  });
  it("summarizes the mailbox per portal in the free connection check", async () => {
    const health = await new EmailAlertsProvider(source([message("jobs-noreply@linkedin.com", { text: linkedinText }), message("notification@emails.hellowork.com", { html: helloworkHtml })])).healthCheck();
    expect(health).toEqual({ status: "HEALTHY", detail: "Connected to imap.example.com/INBOX (read-only). Job alerts in the last 14 days: LinkedIn: 1 emails, 2 postings; Indeed: none; HelloWork: 1 emails, 2 postings; Welcome to the Jungle: none." });
  });
  it("parses IMAP_URL with an encoded or plain @ and rejects a malformed one without echoing the password", () => {
    const expected = { host: "imap.gmail.com", port: 993, secure: true, user: "me@gmail.com", pass: "abcdefghijklmnop", mailbox: "INBOX" };
    expect(imapSettings("imaps://me%40gmail.com:abcdefghijklmnop@imap.gmail.com:993/INBOX")).toEqual(expected);
    expect(imapSettings(" imaps://me@gmail.com:abcdefghijklmnop@imap.gmail.com ")).toEqual(expected);
    expect(imapSettings("imaps://me%40gmail.com:pw@imap.gmail.com/%5BGmail%5D%2FAll%20Mail").mailbox).toBe("[Gmail]/All Mail");
    for (const bad of ["me@gmail.com:secretpw", "imaps://imap.gmail.com:993/INBOX", "https://me%40gmail.com:secretpw@imap.gmail.com"]) {
      let message = ""; try { imapSettings(bad); } catch (error) { message = (error as Error).message; }
      expect(message).toContain("IMAP_URL is malformed"); expect(message).not.toContain("secretpw");
    }
  });
  it("closes the connection after a rejected login, quotes the server's reason and survives the late socket error", async () => {
    const rejected = Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "[AUTHENTICATIONFAILED] Invalid credentials (Failure)" });
    const client = Object.assign(new EventEmitter(), { connect: vi.fn(async () => { throw rejected; }), close: vi.fn(), logout: vi.fn(async () => undefined) });
    const source = imapSource("imaps://me%40gmail.com:secretpassword@imap.gmail.com:993/INBOX", () => client as unknown as ImapFlow);
    const failure = await source.messagesSince(new Date(), 10).then(() => null, (error: Error & { code?: string }) => error);
    expect(failure).toMatchObject({ code: "AUTH" });
    expect(failure!.message).toContain('imap.gmail.com answered: "[AUTHENTICATIONFAILED] Invalid credentials (Failure)"'); expect(failure!.message).not.toContain("secretpassword");
    expect(client.close).toHaveBeenCalledOnce();
    // The production crash: a leftover socket timing out a minute later used to emit an unhandled "error" event.
    expect(() => client.emit("error", Object.assign(new Error("Socket timeout"), { code: "ETIMEOUT" }))).not.toThrow();
  });
  it("treats Gmail's app-password requirement as a login problem and an unreachable server as retryable", () => {
    expect(loginFailure(Object.assign(new Error("Command failed"), { responseText: "[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)" }), "me@gmail.com", "imap.gmail.com")).toMatchObject({ code: "AUTH", retryable: false });
    expect(loginFailure(Object.assign(new Error("connect ETIMEDOUT 142.250.1.1:993"), { code: "ETIMEDOUT" }), "me@gmail.com", "imap.gmail.com")).toMatchObject({ code: "NETWORK", retryable: true });
  });
  it("reports a missing mailbox configuration as an authentication problem", async () => {
    const health = await new EmailAlertsProvider().healthCheck();
    expect(health.status).toBe("FAILED"); expect(health.detail).toContain("IMAP_URL is not configured");
  });
});
