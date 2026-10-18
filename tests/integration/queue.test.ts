import { beforeEach, expect, it } from "vitest";
import { database, describeDb, resetDatabase } from "@/tests/integration/helpers";

describeDb("PostgreSQL task queue", () => {
  beforeEach(resetDatabase);

  it("enqueues idempotently", async () => {
    const { enqueueTask } = await import("@/lib/services/queue"); const db = await database();
    const first = await enqueueTask("SEND_DIGEST", {}, "same-key"); const second = await enqueueTask("SEND_DIGEST", {}, "same-key");
    expect(second.id).toBe(first.id); expect(await db.task.count()).toBe(1);
  });
  it("hands each task to exactly one concurrent claimer (SKIP LOCKED)", async () => {
    const { enqueueTask, claimTask } = await import("@/lib/services/queue");
    for (let index = 0; index < 5; index++) await enqueueTask("SEND_DIGEST", {}, `k${index}`);
    const claimed = await Promise.all(Array.from({ length: 12 }, () => claimTask()));
    const ids = claimed.filter(Boolean).map(task => task!.id); expect(ids).toHaveLength(5); expect(new Set(ids).size).toBe(5);
  });
  it("recovers a task whose worker crashed and fences the stale worker out", async () => {
    const { enqueueTask, claimTask, completeTask } = await import("@/lib/services/queue"); const db = await database();
    const task = await enqueueTask("SEND_DIGEST", {}, "crash"); const crashed = await claimTask(); expect(crashed!.id).toBe(task.id);
    expect(await claimTask()).toBeNull(); // still leased
    await db.task.update({ where: { id: task.id }, data: { leasedUntil: new Date(Date.now() - 1_000) } }); // the worker died; its lease expired
    const recovered = await claimTask(); expect(recovered!.id).toBe(task.id); expect(recovered!.attempts).toBe(2);
    await expect(completeTask(task.id, crashed!.leaseToken!)).rejects.toThrow(/lease was lost/); // stale worker cannot finish it
    await completeTask(task.id, recovered!.leaseToken!); expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("SUCCEEDED");
  });
  it("retries with growing backoff and finally fails after the attempt budget", async () => {
    const { enqueueTask, claimTask, failTask } = await import("@/lib/services/queue"); const db = await database();
    await enqueueTask("SEND_DIGEST", {}, "flaky"); const delays: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      await db.task.updateMany({ data: { runAt: new Date(Date.now() - 1_000) } }); const task = (await claimTask())!;
      await failTask(task, task.leaseToken!, new Error("boom")); const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
      if (attempt < 4) { expect(after.status).toBe("QUEUED"); delays.push(after.runAt.getTime() - Date.now()); } else expect(after.status).toBe("FAILED");
    }
    expect(delays[1]!).toBeGreaterThan(delays[0]!); expect(delays[2]!).toBeGreaterThan(delays[1]!);
  });
  it("never runs a task before its scheduled time", async () => {
    const { enqueueTask, claimTask } = await import("@/lib/services/queue"); const db = await database();
    const task = await enqueueTask("SEND_DIGEST", {}, "later"); await db.task.update({ where: { id: task.id }, data: { runAt: new Date(Date.now() + 60_000) } });
    expect(await claimTask()).toBeNull();
  });
});

describeDb("run lifecycle", () => {
  beforeEach(resetDatabase);
  it("creates a run and its task atomically, reuses an active run, and honours idempotency keys", async () => {
    const { createSearchRun } = await import("@/lib/services/search"); const db = await database();
    const first = await createSearchRun("MANUAL"); expect(await db.task.count({ where: { searchRunId: first.id } })).toBe(1);
    expect((await createSearchRun("MANUAL")).id).toBe(first.id); expect(await db.searchRun.count()).toBe(1);
    await db.searchRun.update({ where: { id: first.id }, data: { status: "FINISHED", idempotencyKey: "gh-1", createdAt: new Date(Date.now() - 4 * 3_600_000) } });
    expect((await createSearchRun("GITHUB_ACTION", "gh-1")).id).toBe(first.id); // replay of a finished run's key: no 500, no new run
  });
  it("skips automated runs right after a finished one but always allows manual runs", async () => {
    const { createSearchRun } = await import("@/lib/services/search"); const db = await database();
    const done = await db.searchRun.create({ data: { trigger: "MANUAL", status: "FINISHED", completedAt: new Date() } });
    expect((await createSearchRun("GITHUB_ACTION", "gh-2")).id).toBe(done.id);
    const manual = await createSearchRun("MANUAL"); expect(manual.id).not.toBe(done.id);
  });
  it("marks abandoned runs failed during maintenance", async () => {
    const { runMaintenance } = await import("@/lib/services/scheduler"); const db = await database();
    const stuck = await db.searchRun.create({ data: { trigger: "MANUAL", status: "RUNNING", createdAt: new Date(Date.now() - 3_600_000) } });
    expect((await runMaintenance()).abandonedRuns).toBe(1); expect((await db.searchRun.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe("FAILED");
  });
});
