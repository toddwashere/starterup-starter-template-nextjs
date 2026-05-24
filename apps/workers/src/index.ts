import { createPgmqAdapter } from "@workspace/worker-queue";
import { keys as queueKeys } from "@workspace/worker-queue/keys";

import { startConsumer, type ConsumerConfig } from "./consumer";
import { handlers } from "./handlers";
import { startHealthServer } from "./health";
import { keys as workerKeys } from "../keys";

const { WORKER_HEALTH_PORT, WORKER_MAX_ATTEMPTS, WORKER_POLL_INTERVAL_MS } =
  workerKeys();
const config: ConsumerConfig = {
  queue: queueKeys().PGMQ_QUEUE_NAME,
  maxAttempts: WORKER_MAX_ATTEMPTS,
  pollIntervalMs: WORKER_POLL_INTERVAL_MS,
};

const healthServer = startHealthServer(WORKER_HEALTH_PORT);
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
