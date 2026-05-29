import { prisma } from "@workspace/database";

import { startBullmqWorker } from "./bullmq-worker";
import { handlers } from "./handlers";
import { startHealthServer, setDraining } from "./health";
import { registerRepeatableJobs } from "./scheduled";
import { keys as workerKeys } from "../keys";

const { WORKER_HEALTH_PORT } = workerKeys();

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const { stop, checkRedis } = startBullmqWorker({ registry: handlers });

const healthServer = startHealthServer(WORKER_HEALTH_PORT, {
  checkDb,
  checkRedis,
});

// Register repeatable jobs on startup (idempotent via jobId).
void registerRepeatableJobs().catch((err) => {
  console.error("[workers] failed to register repeatable jobs", err);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[workers] ${sig} received; shutting down`);
    setDraining(true);
    void (async () => {
      await stop();           // BullMQ drains in-flight job
      healthServer.close();
    })();
  });
}

console.log("[workers] starting bullmq worker");
