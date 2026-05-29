import { z } from "zod";

const schema = z.object({
  WORKER_QUEUE_ADAPTER: z.enum(["bullmq", "pubsub", "sync"]).default("bullmq"),
  BULLMQ_QUEUE_NAME: z.string().default("jobs"),
  REDIS_URL: z.string().url().optional(), // required when adapter is bullmq
  // Pub/Sub
  GCP_PROJECT_ID: z.string().optional(),
  PUBSUB_TOPIC_NAME: z.string().default("jobs"),
  PUBSUB_SUBSCRIPTION_NAME: z.string().default("jobs-sub"),
});

export function keys() {
  return schema.parse({
    WORKER_QUEUE_ADAPTER: process.env.WORKER_QUEUE_ADAPTER,
    BULLMQ_QUEUE_NAME: process.env.BULLMQ_QUEUE_NAME,
    REDIS_URL: process.env.REDIS_URL,
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
    PUBSUB_TOPIC_NAME: process.env.PUBSUB_TOPIC_NAME,
    PUBSUB_SUBSCRIPTION_NAME: process.env.PUBSUB_SUBSCRIPTION_NAME,
  });
}
