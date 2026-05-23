import type { JobEnvelope, QueueAdapter } from "../types";

/**
 * In-memory queue adapter for tests and local development.
 *
 * Every `publish` is recorded in `published` so tests can assert on the exact
 * data that was enqueued (not just that a mock was called). Call `reset()`
 * between tests for isolation.
 */
export class SyncAdapter implements QueueAdapter {
  /** Every published message, in publish order. */
  readonly published: Array<{ queue: string; envelope: JobEnvelope }> = [];

  private nextId = 1;

  async publish(queue: string, envelope: JobEnvelope): Promise<string> {
    this.published.push({ queue, envelope });
    return String(this.nextId++);
  }

  /** Clear all recorded messages and reset the id counter. */
  reset(): void {
    this.published.length = 0;
    this.nextId = 1;
  }
}

/**
 * Shared singleton so `resolveAdapter()` and tests inspect the same instance.
 */
export const syncAdapter = new SyncAdapter();
