// `tsx` does not read .env files (Next.js does), so load it for local `npm run worker`. Hosted environments inject variables directly.
try { process.loadEnvFile?.(); } catch { /* no .env file: rely on the process environment */ }
import { claimTask, completeTask, failTask, renewTaskLease } from "@/lib/services/queue";
import { log } from "@/lib/log";
import { config } from "@/lib/config";
import { runMaintenance, tickScheduler } from "@/lib/services/scheduler";
import { processTask } from "@/workers/processor";

let stopping = false; process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function every(state: { next: number }, intervalMs: number, job: () => Promise<unknown>, name: string) {
  if (Date.now() < state.next) return; state.next = Date.now() + intervalMs;
  try { await job(); } catch (error) { log("error", `${name}_failed`, { stage: name, status: "FAILED" }); console.error((error as Error).message); }
}

async function main() {
  log("info", "worker_started");
  const scheduler = { next: 0 }, maintenance = { next: 0 }; let failures = 0;
  while (!stopping) {
    try {
      await every(maintenance, 3_600_000, runMaintenance, "maintenance");
      await every(scheduler, 60_000, () => tickScheduler(), "scheduler");
      const task = await claimTask();
      if (!task?.leaseToken) { failures = 0; await sleep(2_000); continue; }
      const started = Date.now(); const leaseToken = task.leaseToken;
      const heartbeat = setInterval(() => {
        void renewTaskLease(task.id, leaseToken).then(renewed => { if (!renewed) log("error", "task_lease_lost", { stage: task.type, status: "FAILED" }); }).catch(() => log("error", "task_lease_renewal_failed", { stage: task.type, status: "FAILED" }));
      }, Math.max(1_000, Math.floor(config().TASK_LEASE_SECONDS * 500)));
      try {
        await processTask(task.type, task.payload, { final: task.attempts >= task.maxAttempts });
        await completeTask(task.id, leaseToken); log("info", "task_completed", { stage: task.type, duration: Date.now() - started, status: "SUCCEEDED" });
      } catch (error) {
        await failTask(task, leaseToken, error); log("error", "task_failed", { stage: task.type, duration: Date.now() - started, status: "FAILED", attempt: task.attempts });
      } finally { clearInterval(heartbeat); }
      failures = 0;
    } catch (error) {
      // A database outage or lost lease must not kill the worker: back off and keep polling.
      failures++; log("error", "worker_loop_error", { status: "FAILED", failures }); console.error((error as Error).message);
      await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)));
    }
  }
  log("info", "worker_stopped");
}
main().catch(error => { log("error", "worker_crashed", { status: "FAILED" }); console.error(error); process.exit(1); });
