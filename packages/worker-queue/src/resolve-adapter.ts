import { keys } from "../keys";

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
    case "pgmq":
      // TODO(Task 6): return the pgmq adapter here
      throw new Error("pgmq adapter is not available yet");
    default: {
      const exhaustive: never = adapter;
      throw new Error(`Unknown WORKER_QUEUE_ADAPTER: ${String(exhaustive)}`);
    }
  }
}
