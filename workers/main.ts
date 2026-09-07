import { claimTask, completeTask, failTask, renewTaskLease } from "@/lib/services/queue";
import { log } from "@/lib/log";
import { config } from "@/lib/config";
import { processTask } from "@/workers/processor";

let stopping = false; process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
async function main() {
  log("info", "worker_started");
  while (!stopping) {
    const task = await claimTask();
    if (!task?.leaseToken) { await new Promise(resolve => setTimeout(resolve, 2_000)); continue; }
    const started = Date.now();
    const heartbeat = setInterval(() => {
      void renewTaskLease(task.id, task.leaseToken!).then(renewed => {
        if (!renewed) log("error", "task_lease_lost", { stage: task.type, status: "FAILED" });
      }).catch(() => log("error", "task_lease_renewal_failed", { stage: task.type, status: "FAILED" }));
    }, Math.max(1_000, Math.floor(config().TASK_LEASE_SECONDS * 500)));
    try { await processTask(task.type, task.payload); await completeTask(task.id, task.leaseToken); log("info", "task_completed", { stage: task.type, duration: Date.now() - started, status: "SUCCEEDED" }); }
    catch (error) { await failTask(task, task.leaseToken, error); log("error", "task_failed", { stage: task.type, duration: Date.now() - started, status: "FAILED" }); }
    finally { clearInterval(heartbeat); }
  }
  log("info", "worker_stopped");
}
main().catch(error => { log("error", "worker_crashed", { status: "FAILED" }); console.error(error); process.exit(1); });
