process.env.TELEGRAM_BOT_TOKEN = "test-token"; process.env.TELEGRAM_CHAT_ID = "42";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { database, describeDb, resetDatabase, seedOwner } from "@/tests/integration/helpers";

async function addJob(overrides: Record<string, unknown> = {}) {
  const db = await database(); const key = Math.random().toString(36).slice(2);
  return db.job.create({ data: { canonicalHash: key, contentFingerprint: key, companyName: "Exemple SA", title: `Ingénieur Data ${key}`, normalizedTitle: key, location: "Metz", descriptionRaw: "x", descriptionClean: "x", applicationUrl: `https://careers.example.test/${key}`, rankScore: 88, matchDetails: { blockers: [], summary: "Strong fit" }, sources: { create: { provider: "greenhouse", sourceJobId: key, sourceUrl: `https://boards.example.test/${key}`, extractor: "fixture" } }, ...overrides } });
}
const telegram = (status = 200) => vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status }));
async function enableTelegram(value = true) { const db = await database(); await db.systemSetting.upsert({ where: { key: "notifications.telegram" }, create: { key: "notifications.telegram", value }, update: { value } }); }

describeDb("digest notifications", () => {
  beforeEach(async () => { await resetDatabase(); await seedOwner(); await enableTelegram(); });
  afterEach(() => vi.unstubAllGlobals());

  it("announces each new high-scoring job once, with title, employer, location, score, source and direct link", async () => {
    const fetchMock = telegram(); vi.stubGlobal("fetch", fetchMock); const job = await addJob(); const { sendDigest } = await import("@/lib/services/notifications");
    expect(await sendDigest()).toEqual(["TELEGRAM"]); expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { text: string };
    for (const part of [job.title, "Exemple SA", "Metz", "88/100 Strong Match", "Greenhouse", job.applicationUrl]) expect(body.text).toContain(part);
    expect(await sendDigest()).toEqual([]); expect(fetchMock).toHaveBeenCalledTimes(1); // the same job is never announced again
    await addJob(); expect(await sendDigest()).toEqual(["TELEGRAM"]); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("sends nothing for low scores, blocked, dismissed, old, closed, or already-progressed jobs", async () => {
    const fetchMock = telegram(); vi.stubGlobal("fetch", fetchMock); const db = await database(); const owner = await db.user.findFirstOrThrow();
    await addJob({ rankScore: 60 }); await addJob({ matchDetails: { blockers: ["Excluded term: x"] } }); await addJob({ dismissedAt: new Date() });
    await addJob({ discoveredAt: new Date(Date.now() - 5 * 86_400_000) }); await addJob({ status: "REMOVED" });
    const applied = await addJob(); await db.application.create({ data: { jobId: applied.id, userId: owner.id, status: "APPLIED" } });
    const { sendDigest } = await import("@/lib/services/notifications"); expect(await sendDigest()).toEqual([]); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("respects the owner's threshold and the disabled switch", async () => {
    const fetchMock = telegram(); vi.stubGlobal("fetch", fetchMock); await addJob({ rankScore: 70 }); const { sendDigest } = await import("@/lib/services/notifications"); const { saveSettings } = await import("@/lib/services/settings");
    expect(await sendDigest()).toEqual([]); await saveSettings({ notifications: { minScore: 65 } }); await enableTelegram(false); expect(await sendDigest()).toEqual([]);
    await enableTelegram(true); expect(await sendDigest()).toEqual(["TELEGRAM"]);
  });
  it("releases the reservation when delivery fails so the next attempt retries", async () => {
    await addJob(); const { sendDigest } = await import("@/lib/services/notifications"); const db = await database();
    vi.stubGlobal("fetch", telegram(500)); await expect(sendDigest()).rejects.toThrow(/Telegram returned HTTP 500/);
    expect(await db.jobNotification.count()).toBe(0); expect((await db.notification.findFirstOrThrow()).status).toBe("FAILED");
    vi.stubGlobal("fetch", telegram()); expect(await sendDigest()).toEqual(["TELEGRAM"]); expect(await db.jobNotification.count({ where: { status: "SENT" } })).toBe(1);
  });
  it("does not double-send when two workers race", async () => {
    const fetchMock = telegram(); vi.stubGlobal("fetch", fetchMock); await addJob(); await addJob(); const { sendDigest } = await import("@/lib/services/notifications");
    await Promise.allSettled([sendDigest(), sendDigest(), sendDigest()]); expect(fetchMock.mock.calls.length).toBe(1);
  });
  it("sends a clearly labelled test message", async () => {
    const fetchMock = telegram(); vi.stubGlobal("fetch", fetchMock); const { sendTestNotification } = await import("@/lib/services/notifications");
    await sendTestNotification("TELEGRAM"); expect(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toContain("test");
  });
});
