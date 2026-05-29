import { Worker, type Job } from "bullmq";

import {
  parseJobEnvelope,
  type EventName,
  type JobEnvelope,
} from "@workspace/worker-queue";
import { keys as queueKeys } from "@workspace/worker-queue/keys";

import { getHandler, type HandlerRegistry } from "./registry";

export interface BullmqWorkerDeps {
  registry: HandlerRegistry;
  concurrency?: number;
}

/** Start a BullMQ Worker. Returns an async `stop()` that drains in-flight jobs. */
export function startBullmqWorker(deps: BullmqWorkerDeps): () => Promise<void> {
  const { REDIS_URL, BULLMQ_QUEUE_NAME } = queueKeys();
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is required for the bullmq worker");
  }

  const connection = { url: REDIS_URL, maxRetriesPerRequest: null as null };

  const worker = new Worker(
    BULLMQ_QUEUE_NAME,
    async (job: Job) => {
      // BullMQ retries on throw (attempts config set at enqueue). Poison
      // messages (parse failures) should NOT be retried — handle that here.
      let envelope: JobEnvelope;
      try {
        envelope = parseJobEnvelope(job.data);
      } catch (error) {
        console.error(`[workers] poison job ${job.id}; not retrying`, error);
        // Returning normally marks the job as completed so BullMQ will not retry
        // the poison data forever. (removeOnFail keeps real failures for DLQ.)
        return;
      }

      const handler = getHandler(deps.registry, envelope.event as EventName);
      await handler(envelope.payload as never);
    },
    {
      connection,
      concurrency: deps.concurrency ?? 1,
    },
  );

  worker.on("failed", (job, error) => {
    console.error(
      `[workers] job ${job?.id ?? "?"} failed (attempt ${
        job?.attemptsMade ?? "?"
      })`,
      error,
    );
  });

  worker.on("completed", (job) => {
    console.log(`[workers] job ${job.id} completed (${job.name})`);
  });

  return async () => {
    await worker.close();
  };
}
