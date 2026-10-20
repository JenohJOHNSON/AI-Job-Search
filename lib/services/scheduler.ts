import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { createSearchRun } from "@/lib/services/search";
import { loadSettings, type RuntimeSettings } from "@/lib/services/settings";

/** Local calendar date and minutes-since-midnight in the given IANA time zone. */
export function zonedClock(now: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(part => [part.type, part.value]));
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Pure decision: is today's scheduled run due? Returns the idempotency key to use, or null. A late start still catches up the same day. */
export function scheduledRunKey(schedule: RuntimeSettings["schedule"], now: Date): string | null {
  if (!schedule.enabled) return null;
  const [hours, minutes] = schedule.time.split(":").map(Number); const clock = zonedClock(now, schedule.timezone);
  return clock.minutes >= hours! * 60 + minutes! ? `scheduled:${clock.dateKey}` : null;
}

/** Queues the daily search once per local day when the owner has set everything up. Safe to call every minute from any number of workers. */
export async function tickScheduler(now = new Date()) {
  const settings = await loadSettings(); const key = scheduledRunKey(settings.schedule, now); if (!key) return null;
  if (await db.searchRun.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) return null;
  const [profiles, providers] = await Promise.all([db.searchProfile.count({ where: { enabled: true } }), db.providerSetting.count({ where: { enabled: true, supported: true } })]);
  if (!profiles || !providers) return null; // nothing to search yet: do not create a run that can only fail
  const run = await createSearchRun("SCHEDULED", key); log("info", "scheduled_run_queued", { stage: "scheduler", status: run.status }); return run;
}

/** Housekeeping: expired sessions, old finished tasks, and runs whose task can no longer execute. */
export async function runMaintenance(now = new Date()) {
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const tasks = await db.task.deleteMany({ where: { status: "SUCCEEDED", completedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  const stuck = await db.searchRun.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] }, createdAt: { lt: new Date(now.getTime() - 10 * 60_000) }, tasks: { none: { status: { in: ["QUEUED", "RUNNING"] } } } }, select: { id: true } });
  if (stuck.length) await db.searchRun.updateMany({ where: { id: { in: stuck.map(run => run.id) } }, data: { status: "FAILED", completedAt: now, errors: [{ provider: "-", code: "UNKNOWN", message: "The run was abandoned: its background task is no longer active." }] } });
  return { sessions: sessions.count, tasks: tasks.count, abandonedRuns: stuck.length };
}
