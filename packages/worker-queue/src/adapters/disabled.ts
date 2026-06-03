import type { JobEnvelope, QueueAdapter } from "../types";

let warned = false;

/**
 * No-op adapter used when BullMQ is configured but REDIS_URL is unset (local dev).
 * Jobs are not persisted or processed; callers still receive a synthetic message id.
 */
export function createDisabledAdapter(): QueueAdapter {
  return {
    async publish(_queue: string, envelope: JobEnvelope): Promise<string> {
      if (!warned) {
        console.warn(
          `[worker-queue] REDIS_URL not set; skipping background job "${envelope.event}" (dev only)`,
        );
        warned = true;
      }
      return "disabled";
    },
  };
}

/** Reset warn-once state — for tests only. */
export function resetDisabledAdapterWarning(): void {
  warned = false;
}
