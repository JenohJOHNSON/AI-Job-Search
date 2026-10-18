import { beforeEach, describe, expect, it } from "vitest";
import { scheduledRunKey } from "@/lib/services/scheduler";
import { database, describeDb, resetDatabase, seedOwner } from "@/tests/integration/helpers";


const schedule = { enabled: true, time: "06:30", timezone: "Europe/Paris" };

describe("schedule decision (pure)", () => {
  it("fires at the local wall-clock time in both summer and winter time", () => {
    expect(scheduledRunKey(schedule, new Date("2026-10-18T04:29:00Z"))).toBeNull(); // 06:29 CEST
    expect(scheduledRunKey(schedule, new Date("2026-10-18T04:30:00Z"))).toBe("scheduled:2026-10-18"); // 06:30 CEST
    expect(scheduledRunKey(schedule, new Date("2026-12-01T05:29:00Z"))).toBeNull(); // 06:29 CET
    expect(scheduledRunKey(schedule, new Date("2026-12-01T05:30:00Z"))).toBe("scheduled:2026-12-01"); // 06:30 CET
  });
  it("catches up the same day after downtime and never fires when disabled", () => {
    expect(scheduledRunKey(schedule, new Date("2026-10-18T15:00:00Z"))).toBe("scheduled:2026-10-18");
    expect(scheduledRunKey({ ...schedule, enabled: false }, new Date("2026-10-18T15:00:00Z"))).toBeNull();
  });
  it("uses the local date, not UTC, for the idempotency key", () => {
    expect(scheduledRunKey({ ...schedule, time: "00:10" }, new Date("2026-10-17T22:30:00Z"))).toBe("scheduled:2026-10-18"); // 00:30 CEST on the 18th
  });
});

describeDb("scheduler tick", () => {
  beforeEach(resetDatabase);
  const due = new Date("2026-10-18T09:00:00Z");
  async function configure() { const db = await database(); const { ensureProviders } = await import("@/lib/services/providers"); await ensureProviders(); await db.providerSetting.update({ where: { id: "greenhouse" }, data: { enabled: true, config: { boards: ["acme"] } } }); }

  it("queues exactly one run per local day, even when ticked repeatedly or by several workers", async () => {
    await seedOwner(); await configure(); const { tickScheduler } = await import("@/lib/services/scheduler"); const db = await database();
    await Promise.all([tickScheduler(due), tickScheduler(due), tickScheduler(due)]); await tickScheduler(due);
    expect(await db.searchRun.count({ where: { trigger: "SCHEDULED" } })).toBe(1); expect(await db.task.count({ where: { type: "SEARCH_RUN" } })).toBe(1);
  });
  it("does nothing until a search profile and an enabled source exist", async () => {
    const { tickScheduler } = await import("@/lib/services/scheduler"); const db = await database();
    await seedOwner({ searchProfile: null }); await tickScheduler(due); expect(await db.searchRun.count()).toBe(0);
  });
  it("does nothing before the configured time or when switched off", async () => {
    await seedOwner(); await configure(); const { tickScheduler } = await import("@/lib/services/scheduler"); const { saveSettings } = await import("@/lib/services/settings"); const db = await database();
    await tickScheduler(new Date("2026-10-18T03:00:00Z")); expect(await db.searchRun.count()).toBe(0);
    await saveSettings({ schedule: { enabled: false } }); await tickScheduler(due); expect(await db.searchRun.count()).toBe(0);
  });
});
