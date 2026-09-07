import { randomUUID } from "node:crypto";
import type { Prisma, Task } from "@prisma/client";
import { db } from "@/lib/db";
import { config } from "@/lib/config";

export async function enqueueTask(type: string, payload: Prisma.InputJsonValue, idempotencyKey: string, searchRunId?: string) {
  return db.task.upsert({ where: { idempotencyKey }, create: { type, payload, idempotencyKey, searchRunId }, update: {}, });
}
export async function claimTask(): Promise<Task | null> {
  const token = randomUUID(); const seconds = config().TASK_LEASE_SECONDS;
  const rows = await db.$queryRaw<Task[]>`
    WITH candidate AS (
      SELECT id FROM "Task"
      WHERE ((status = 'QUEUED' AND "runAt" <= NOW()) OR (status = 'RUNNING' AND "leasedUntil" < NOW()))
      ORDER BY "runAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "Task" t SET status = 'RUNNING', "leaseToken" = ${token}, "leasedUntil" = NOW() + (${seconds} * INTERVAL '1 second'), attempts = attempts + 1, "updatedAt" = NOW()
    FROM candidate WHERE t.id = candidate.id RETURNING t.*`;
  return rows[0] ?? null;
}
export async function completeTask(id: string, leaseToken: string) { const result = await db.task.updateMany({ where: { id, leaseToken, status: "RUNNING" }, data: { status: "SUCCEEDED", completedAt: new Date(), leasedUntil: null, leaseToken: null } }); if (!result.count) throw new Error("Task lease was lost before completion."); }
export async function renewTaskLease(id: string, leaseToken: string) {
  const result = await db.task.updateMany({
    where: { id, leaseToken, status: "RUNNING" },
    data: { leasedUntil: new Date(Date.now() + config().TASK_LEASE_SECONDS * 1_000) },
  });
  return result.count === 1;
}
export async function failTask(task: Task, leaseToken: string, error: unknown) { const final = task.attempts >= task.maxAttempts; const delaySeconds = Math.min(3600, 10 * 2 ** Math.max(0, task.attempts - 1)); const result = await db.task.updateMany({ where: { id: task.id, leaseToken, status: "RUNNING" }, data: { status: final ? "FAILED" : "QUEUED", error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error", leasedUntil: null, leaseToken: null, runAt: new Date(Date.now() + delaySeconds * 1000), completedAt: final ? new Date() : null } }); if (!result.count) throw new Error("Task lease was lost while recording failure."); }
