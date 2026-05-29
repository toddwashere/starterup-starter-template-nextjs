import { keys } from "../keys";

import { createBullmqAdapter } from "./adapters/bullmq";
import { createPubsubAdapter } from "./adapters/pubsub";
import { createSqsAdapter } from "./adapters/sqs";
import { syncAdapter } from "./adapters/sync";
import type { QueueAdapter } from "./types";

/**
 * Select the queue adapter based on `WORKER_QUEUE_ADAPTER`.
 */
export function resolveAdapter(): QueueAdapter {
  const adapter = keys().WORKER_QUEUE_ADAPTER;
  switch (adapter) {
    case "sync":
      return syncAdapter;
    case "bullmq":
      return createBullmqAdapter();
    case "pubsub":
      return createPubsubAdapter();
    case "sqs":
      return createSqsAdapter();
    default: {
      const exhaustive: never = adapter;
      throw new Error(`Unknown WORKER_QUEUE_ADAPTER: ${String(exhaustive)}`);
    }
  }
}
