import { Queue } from "bullmq";
import { keys as queueKeys } from "@workspace/worker-queue/keys";

/**
 * Register BullMQ repeatable jobs. Safe to call on every startup — BullMQ
 * deduplicates by jobId so no duplicate repeatables are created.
 */
export async function registerRepeatableJobs(): Promise<void> {
  const { REDIS_URL, BULLMQ_QUEUE_NAME } = queueKeys();
  if (!REDIS_URL) {
    console.warn(
      "[workers] REDIS_URL not set; skipping repeatable job registration",
    );
    return;
  }

  const connection = { url: REDIS_URL, maxRetriesPerRequest: null as null };
  const queue = new Queue(BULLMQ_QUEUE_NAME, { connection });

  try {
    await queue.add(
      "cleanup.expired-sessions",
      {
        event: "cleanup.expired-sessions",
        payload: {},
        enqueuedAt: new Date().toISOString(),
      },
      {
        repeat: { pattern: "0 3 * * *" },
        jobId: "cleanup-expired-sessions",
      },
    );
    console.log("[workers] repeatable job registered: cleanup.expired-sessions");
  } finally {
    await queue.close();
  }
}
