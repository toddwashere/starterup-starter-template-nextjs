import { z } from "zod";

const schema = z.object({
  WORKER_QUEUE_ADAPTER: z.enum(["bullmq", "sync"]).default("bullmq"),
  BULLMQ_QUEUE_NAME: z.string().default("jobs"),
  REDIS_URL: z.string().url().optional(), // required when adapter is bullmq
});

export function keys() {
  return schema.parse({
    WORKER_QUEUE_ADAPTER: process.env.WORKER_QUEUE_ADAPTER,
    BULLMQ_QUEUE_NAME: process.env.BULLMQ_QUEUE_NAME,
    REDIS_URL: process.env.REDIS_URL,
  });
}
