import { startBullmqWorker } from "./bullmq-worker";
import { handlers } from "./handlers";
import { startHealthServer } from "./health";
import { registerRepeatableJobs } from "./scheduled";
import { keys as workerKeys } from "../keys";

const { WORKER_HEALTH_PORT } = workerKeys();

const healthServer = startHealthServer(WORKER_HEALTH_PORT);
const stop = startBullmqWorker({ registry: handlers });

// Register repeatable jobs on startup (idempotent via jobId).
void registerRepeatableJobs().catch((err) => {
  console.error("[workers] failed to register repeatable jobs", err);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[workers] ${sig} received; shutting down`);
    void (async () => {
      await stop();
      healthServer.close();
    })();
  });
}

console.log("[workers] starting bullmq worker");
