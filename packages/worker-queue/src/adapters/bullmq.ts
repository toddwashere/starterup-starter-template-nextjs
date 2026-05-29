import { Queue } from "bullmq";

import { keys } from "../../keys";
import type { JobEnvelope, QueueAdapter } from "../types";

export function createBullmqAdapter(): QueueAdapter {
  const { REDIS_URL } = keys();
  if (!REDIS_URL)
    throw new Error("REDIS_URL is required for the bullmq adapter");
  // Pass options object (url + maxRetriesPerRequest) instead of an IORedis
  // instance to avoid a dual-version type conflict when the workspace and
  // bullmq's bundled ioredis resolve to different copies.
  const connection = { url: REDIS_URL, maxRetriesPerRequest: null as null };
  const queueName = keys().BULLMQ_QUEUE_NAME;
  const queue = new Queue(queueName, { connection });

  return {
    async publish(_queue, envelope: JobEnvelope) {
      const job = await queue.add(envelope.event, envelope, {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      });
      return String(job.id);
    },
  };
}
