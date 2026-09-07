import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "@/lib/config";
import { db } from "@/lib/db";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function dateKey() { const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); return new Date(`${key}T00:00:00.000Z`); }
async function enabled(key: string) { const setting = await db.systemSetting.findUnique({ where: { key } }); return setting?.value === true; }
async function reserve(channel: string, recipient: string) { const recipientHash = createHash("sha256").update(recipient).digest("hex"); try { return await db.notification.create({ data: { channel, recipientHash, calendarDate: dateKey(), status: "PENDING" } }); } catch { return null; } }

export async function sendDailyDigest() {
  const env = config(); const since = new Date(Date.now() - 36 * 3_600_000); const jobs = await db.job.findMany({ where: { discoveredAt: { gte: since }, matchScore: { gte: env.NOTIFICATION_SCORE_THRESHOLD }, status: "ACTIVE" }, orderBy: { matchScore: "desc" }, take: 12, include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!jobs.length) return;
  const lines = jobs.map(job => `${job.matchScore ?? "—"} — ${job.title} — ${job.companyName}\n${job.applicationUrl}`);
  if (await enabled("notifications.email") && env.DIGEST_TO && env.EMAIL_FROM) {
    const notification = await reserve("EMAIL", env.DIGEST_TO); if (notification) try { const subject = `${jobs.length} relevant new ${jobs.length === 1 ? "job" : "jobs"} found`; const html = `<h1>${escape(subject)}</h1>${jobs.map(job => `<p><strong>${job.matchScore ?? "—"} — ${escape(job.title)}</strong><br>${escape(job.companyName)} · ${escape(job.location)}<br>${escape((job.analyses[0]?.result as { summary?: string } | undefined)?.summary ?? "")}<br><a href="${escape(job.applicationUrl)}">Open application</a></p>`).join("")}`; let externalId = ""; if (env.RESEND_API_KEY) { const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [env.DIGEST_TO], subject, html }) }); if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}.`); externalId = String(((await response.json()) as { id?: string }).id ?? ""); } else if (env.SMTP_URL) { const result = await nodemailer.createTransport(env.SMTP_URL).sendMail({ from: env.EMAIL_FROM, to: env.DIGEST_TO, subject, html }); externalId = result.messageId; } else throw new Error("No email transport is configured."); await db.notification.update({ where: { id: notification.id }, data: { status: "SENT", externalId } }); } catch (error) { await db.notification.update({ where: { id: notification.id }, data: { status: "FAILED", error: (error as Error).message.slice(0, 1_000) } }); throw error; }
  }
  if (await enabled("notifications.telegram") && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const notification = await reserve("TELEGRAM", env.TELEGRAM_CHAT_ID); if (notification) try { const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `${jobs.length} relevant new jobs\n\n${lines.join("\n\n")}`, disable_web_page_preview: true }) }); if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}.`); const result = await response.json() as { result?: { message_id?: number } }; await db.notification.update({ where: { id: notification.id }, data: { status: "SENT", externalId: String(result.result?.message_id ?? "") } }); } catch (error) { await db.notification.update({ where: { id: notification.id }, data: { status: "FAILED", error: (error as Error).message.slice(0, 1_000) } }); throw error; }
  }
}
