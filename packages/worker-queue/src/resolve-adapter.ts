import { keys } from "../keys";

import { createBullmqAdapter } from "./adapters/bullmq";
import { createDisabledAdapter } from "./adapters/disabled";
import { createPubsubAdapter } from "./adapters/pubsub";
import { createServiceBusAdapter } from "./adapters/servicebus";
import { createSqsAdapter } from "./adapters/sqs";
import { syncAdapter } from "./adapters/sync";
import type { QueueAdapter } from "./types";

/**
 * Select the queue adapter based on `WORKER_QUEUE_ADAPTER`.
 */
export function resolveAdapter(): QueueAdapter {
  const config = keys();
  const adapter = config.WORKER_QUEUE_ADAPTER;
  switch (adapter) {
    case "sync":
      return syncAdapter;
    case "bullmq":
      if (!config.REDIS_URL) {
        if (process.env.NODE_ENV === "production") {
          throw new Error("REDIS_URL is required for the bullmq adapter");
        }
        return createDisabledAdapter();
      }
      return createBullmqAdapter();
    case "pubsub":
      return createPubsubAdapter();
    case "sqs":
      return createSqsAdapter();
    case "servicebus":
      return createServiceBusAdapter();
    default: {
      const exhaustive: never = adapter;
      throw new Error(`Unknown WORKER_QUEUE_ADAPTER: ${String(exhaustive)}`);
    }
  }
}
