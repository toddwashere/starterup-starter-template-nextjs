import { keys } from "../keys";

import { createBullmqAdapter } from "./adapters/bullmq";
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
    default: {
      const exhaustive: never = adapter;
      throw new Error(`Unknown WORKER_QUEUE_ADAPTER: ${String(exhaustive)}`);
    }
  }
}
