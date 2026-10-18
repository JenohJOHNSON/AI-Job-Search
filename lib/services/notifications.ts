import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "@/lib/config";
import { parisDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { loadSettings } from "@/lib/services/settings";
import { labelFor, labelText, type MatchResult } from "@/matching/score";

type Channel = "EMAIL" | "TELEGRAM";
type DigestJob = { id: string; title: string; companyName: string; location: string; rankScore: number | null; applicationUrl: string; providers: string[]; summary: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const safeUrl = (value: string) => /^https?:\/\//i.test(value) ? value : "";
const sourceNames: Record<string, string> = { france_travail: "France Travail", greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", generic: "Career page", manual: "Manual import" };
const scoreLine = (job: DigestJob) => `${job.rankScore ?? "—"}/100 ${labelText[labelFor(job.rankScore ?? 0)]}`;

export function renderDigest(jobs: DigestJob[]) {
  const subject = `${jobs.length} new relevant ${jobs.length === 1 ? "job" : "jobs"} found`;
  const html = `<h1>${escapeHtml(subject)}</h1>${jobs.map(job => `<p><strong>${escapeHtml(job.title)}</strong> — ${escapeHtml(job.companyName)}<br>${escapeHtml(job.location || "Location not stated")} · ${escapeHtml(scoreLine(job))} · ${escapeHtml(job.providers.map(id => sourceNames[id] ?? id).join(", "))}<br>${escapeHtml(job.summary)}<br>${safeUrl(job.applicationUrl) ? `<a href="${escapeHtml(job.applicationUrl)}">Open the application page</a>` : ""}</p>`).join("")}`;
  const text = jobs.map(job => `${scoreLine(job)} — ${job.title}\n${job.companyName} · ${job.location || "Location not stated"} · ${job.providers.map(id => sourceNames[id] ?? id).join(", ")}\n${job.applicationUrl}`).join("\n\n");
  return { subject, html, text: `${subject}\n\n${text}` };
}

async function deliverEmail(subject: string, html: string, text: string) {
  const env = config();
  if (!env.EMAIL_FROM || !env.DIGEST_TO) throw new Error("EMAIL_FROM and DIGEST_TO must be configured.");
  if (env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [env.DIGEST_TO], subject, html, text }) });
    if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}.`);
    return String(((await response.json()) as { id?: string }).id ?? "");
  }
  if (env.SMTP_URL) return (await nodemailer.createTransport(env.SMTP_URL).sendMail({ from: env.EMAIL_FROM, to: env.DIGEST_TO, subject, html, text })).messageId;
  throw new Error("No email transport is configured (set RESEND_API_KEY or SMTP_URL).");
}
async function deliverTelegram(text: string) {
  const env = config();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured.");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4_000), disable_web_page_preview: true }) });
  if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}.`);
  return String(((await response.json()) as { result?: { message_id?: number } }).result?.message_id ?? "");
}
export const channelsConfigured = () => { const env = config(); return { email: Boolean(env.EMAIL_FROM && env.DIGEST_TO && (env.RESEND_API_KEY || env.SMTP_URL)), telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) }; };

/** Sends a clearly labelled test message so the owner can verify credentials without waiting for a real match. */
export async function sendTestNotification(channel: Channel) {
  const subject = "Élan test notification"; const body = "This is a test from Élan. If you can read it, notifications for this channel work.";
  if (channel === "EMAIL") return deliverEmail(subject, `<p>${escapeHtml(body)}</p>`, body);
  return deliverTelegram(`${subject}\n\n${body}`);
}

/**
 * Announces genuinely new, high-scoring vacancies once per channel. Jobs are reserved before sending, so a retry after a
 * crash cannot announce the same job twice (delivery is at-most-once; a failed send releases its reservation for the next try).
 */
export async function sendDigest() {
  const env = config(); const settings = await loadSettings(); const available = channelsConfigured(); const sent: Channel[] = []; const failures: string[] = [];
  const channels: Channel[] = [...(settings.notifications.emailEnabled && available.email ? ["EMAIL" as const] : []), ...(settings.notifications.telegramEnabled && available.telegram ? ["TELEGRAM" as const] : [])];
  for (const channel of channels) {
    const candidates = await db.job.findMany({
      where: { status: "ACTIVE", dismissedAt: null, rankScore: { gte: settings.notifications.minScore }, discoveredAt: { gte: new Date(Date.now() - 72 * 3_600_000) }, notifications: { none: { channel } }, OR: [{ application: null }, { application: { status: "NEW" } }] },
      orderBy: { rankScore: "desc" }, take: settings.notifications.maxPerDigest * 2, include: { sources: { select: { provider: true } } }
    });
    const eligible = candidates.filter(job => !((job.matchDetails as MatchResult | null)?.blockers?.length)).slice(0, settings.notifications.maxPerDigest);
    if (!eligible.length) continue;
    const recipient = channel === "EMAIL" ? env.DIGEST_TO ?? "" : env.TELEGRAM_CHAT_ID;
    const notification = await db.$transaction(async tx => {
      const created = await tx.notification.create({ data: { channel, recipientHash: createHash("sha256").update(recipient).digest("hex"), calendarDate: parisDate(), status: "PENDING" } });
      const reserved = await tx.jobNotification.createMany({ data: eligible.map(job => ({ jobId: job.id, channel, notificationId: created.id })), skipDuplicates: true });
      if (!reserved.count) { await tx.notification.delete({ where: { id: created.id } }); return null; }
      return created;
    });
    if (!notification) continue;
    const reservedJobs = await db.jobNotification.findMany({ where: { notificationId: notification.id }, select: { jobId: true } }); const reservedIds = new Set(reservedJobs.map(item => item.jobId));
    const jobs: DigestJob[] = eligible.filter(job => reservedIds.has(job.id)).map(job => ({ id: job.id, title: job.title, companyName: job.companyName, location: job.location, rankScore: job.rankScore, applicationUrl: job.applicationUrl, providers: [...new Set(job.sources.map(source => source.provider))], summary: (job.matchDetails as MatchResult | null)?.summary ?? "" }));
    try {
      const rendered = renderDigest(jobs); const externalId = channel === "EMAIL" ? await deliverEmail(rendered.subject, rendered.html, rendered.text) : await deliverTelegram(rendered.text);
      await db.$transaction([db.notification.update({ where: { id: notification.id }, data: { status: "SENT", externalId } }), db.jobNotification.updateMany({ where: { notificationId: notification.id }, data: { status: "SENT" } })]);
      log("info", "digest_sent", { stage: channel, status: "SUCCEEDED", count: jobs.length }); sent.push(channel);
    } catch (error) {
      await db.$transaction([db.notification.update({ where: { id: notification.id }, data: { status: "FAILED", error: (error as Error).message.slice(0, 1_000) } }), db.jobNotification.deleteMany({ where: { notificationId: notification.id } })]);
      log("error", "digest_failed", { stage: channel, status: "FAILED" }); failures.push(`${channel}: ${(error as Error).message}`);
    }
  }
  if (failures.length) throw new Error(failures.join("; ").slice(0, 1_000));
  return sent;
}
