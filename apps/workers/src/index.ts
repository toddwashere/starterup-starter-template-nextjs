import { createPgmqAdapter } from "@workspace/worker-queue";
import { keys } from "@workspace/worker-queue/keys";

import { startConsumer, type ConsumerConfig } from "./consumer";
import { handlers } from "./handlers";
import { startHealthServer } from "./health";

const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 4300);
const config: ConsumerConfig = {
  queue: keys().PGMQ_QUEUE_NAME,
  maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 5),
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
};

const healthServer = startHealthServer(healthPort);
const adapter = createPgmqAdapter();
const controller = new AbortController();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[workers] ${sig} received; shutting down`);
    controller.abort();
    healthServer.close();
  });
}

console.log("[workers] starting consumer");
startConsumer({ adapter, registry: handlers, config }, controller.signal).catch(
  (error) => {
    console.error("[workers] consumer crashed", error);
    process.exit(1);
  },
);
