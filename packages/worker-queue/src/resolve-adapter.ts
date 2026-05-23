import { keys } from "../keys";

import { createPgmqAdapter } from "./adapters/pgmq";
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
      // Constructs the adapter object only; the pg pool is created lazily on
      // the first query (see getPool in adapters/pgmq), so selecting sync or
      // merely importing this module never opens a DB connection.
      return createPgmqAdapter();
    default: {
      const exhaustive: never = adapter;
      throw new Error(`Unknown WORKER_QUEUE_ADAPTER: ${String(exhaustive)}`);
    }
  }
}
