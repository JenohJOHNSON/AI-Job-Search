import { beforeEach, expect, it } from "vitest";
import { database, describeDb, resetDatabase, seedOwner } from "@/tests/integration/helpers";

describeDb("owner settings", () => {
  beforeEach(resetDatabase);
  it("defaults come from the environment and edits persist", async () => {
    const { loadSettings, saveSettings } = await import("@/lib/services/settings");
    expect(await loadSettings()).toMatchObject({ notifications: { minScore: 80, emailEnabled: false }, schedule: { enabled: true, time: "06:30", timezone: "Europe/Paris" } });
    await saveSettings({ notifications: { minScore: 70, telegramEnabled: true }, schedule: { time: "07:05" } });
    expect(await loadSettings()).toMatchObject({ notifications: { minScore: 70, telegramEnabled: true }, schedule: { time: "07:05", enabled: true } });
  });
  it("never lets stored values exceed the operator's environment ceilings", async () => {
    const { loadSettings } = await import("@/lib/services/settings"); const db = await database();
    await db.systemSetting.createMany({ data: [{ key: "ai.maxCostPerDay", value: 9_999 }, { key: "ai.maxAnalysesPerDay", value: 99_999 }, { key: "limits.maxJobsPerProvider", value: 500 }] });
    const settings = await loadSettings(); expect(settings.ai.maxCostPerDay).toBeLessThanOrEqual(2); expect(settings.ai.maxAnalysesPerDay).toBeLessThanOrEqual(30); expect(settings.limits.maxJobsPerProvider).toBeLessThanOrEqual(50);
  });
  it("validates patches", async () => {
    const { settingsPatchSchema } = await import("@/lib/services/settings");
    expect(settingsPatchSchema.safeParse({ schedule: { time: "25:00" } }).success).toBe(false); expect(settingsPatchSchema.safeParse({ schedule: { timezone: "Mars/Olympus" } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ notifications: { minScore: 101 } }).success).toBe(false); expect(settingsPatchSchema.safeParse({ surprise: 1 }).success).toBe(false);
  });
});

describeDb("personal data deletion", () => {
  beforeEach(resetDatabase);
  it("removes the owner and every private record while keeping public vacancy data", async () => {
    const owner = await seedOwner(); const db = await database();
    const job = await db.job.create({ data: { canonicalHash: "h", contentFingerprint: "f", companyName: "Acme", title: "Data Engineer", normalizedTitle: "data engineer", location: "Metz", descriptionRaw: "x", descriptionClean: "x", applicationUrl: "https://example.test/1" } });
    await db.application.create({ data: { jobId: job.id, userId: owner.id, status: "APPLIED", history: { create: { toStatus: "APPLIED" } } } });
    await db.resume.create({ data: { userId: owner.id, fileName: "cv.txt", mimeType: "text/plain", size: 3, contentHash: "x", sourceText: "private cv", original: Buffer.from("private cv") } });
    await db.generatedDocument.create({ data: { userId: owner.id, jobId: job.id, kind: "cv", language: "fr", markdown: "private" } });
    await db.session.create({ data: { userId: owner.id, tokenHash: "t", expiresAt: new Date(Date.now() + 1e6) } });
    await db.user.delete({ where: { id: owner.id } });
    for (const count of [await db.user.count(), await db.candidateProfile.count(), await db.searchProfile.count(), await db.resume.count(), await db.application.count(), await db.applicationHistory.count(), await db.generatedDocument.count(), await db.session.count()]) expect(count).toBe(0);
    expect(await db.job.count()).toBe(1);
  });
});
