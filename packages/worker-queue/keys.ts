import { z } from "zod";

const schema = z.object({
  WORKER_QUEUE_ADAPTER: z.enum(["pgmq", "sync"]).default("pgmq"),
  PGMQ_QUEUE_NAME: z.string().default("jobs"),
});

export function keys() {
  return schema.parse({
    WORKER_QUEUE_ADAPTER: process.env.WORKER_QUEUE_ADAPTER,
    PGMQ_QUEUE_NAME: process.env.PGMQ_QUEUE_NAME,
  });
}
