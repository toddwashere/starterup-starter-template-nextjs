import { prisma } from "@workspace/database";
import { keys as queueKeys } from "@workspace/worker-queue/keys";

import { startBullmqWorker } from "./bullmq-worker";
import { startPubsubWorker } from "./pubsub-worker";
import { startServiceBusWorker } from "./servicebus-worker";
import { startSqsWorker } from "./sqs-worker";
import { handlers } from "./handlers";
import { startHealthServer, setDraining } from "./health";
import { registerRepeatableJobs } from "./scheduled";
import { isBullmqWorkerDisabled } from "./is-bullmq-worker-disabled";
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

const adapterName = queueKeys().WORKER_QUEUE_ADAPTER;
const workerDisabled = isBullmqWorkerDisabled(adapterName);
let stop: () => Promise<void> = async () => {};
let checkRedis: (() => Promise<boolean>) | undefined;

if (workerDisabled) {
  console.log("[workers] idle — set REDIS_URL to enable job processing");
} else if (adapterName === "bullmq") {
  const worker = startBullmqWorker({ registry: handlers });
  stop = worker.stop;
  checkRedis = worker.checkRedis;
} else if (adapterName === "pubsub") {
  const worker = startPubsubWorker({ registry: handlers });
  stop = worker.stop;
} else if (adapterName === "sqs") {
  const worker = startSqsWorker({ registry: handlers });
  stop = worker.stop;
} else if (adapterName === "servicebus") {
  const worker = startServiceBusWorker({ registry: handlers });
  stop = worker.stop;
} else {
  throw new Error(`Unsupported worker adapter for this app: ${adapterName}`);
}

const healthServer = startHealthServer(WORKER_HEALTH_PORT, {
  checkDb,
  checkRedis,
});

// Register repeatable jobs on startup (idempotent via jobId).
if (!workerDisabled) {
  void registerRepeatableJobs().catch((err) => {
    console.error("[workers] failed to register repeatable jobs", err);
  });
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[workers] ${sig} received; shutting down`);
    setDraining(true);
    void (async () => {
      await stop();
      healthServer.close();
    })();
  });
}

console.log(
  workerDisabled
    ? "[workers] running in idle mode (no queue consumer)"
    : `[workers] starting ${adapterName} worker`,
);
