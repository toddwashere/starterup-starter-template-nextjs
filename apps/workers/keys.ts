import { z } from "zod";

const schema = z.object({
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4300),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Workers use this URL in outbound email links. The Next.js NEXT_PUBLIC_
  // prefix is a build-time convention only; workers read the same runtime
  // value as a plain string.
  DASHBOARD_URL: z.string().url().default("http://localhost:4000"),
});

export function keys() {
  return schema.parse({
    WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT,
    WORKER_POLL_INTERVAL_MS: process.env.WORKER_POLL_INTERVAL_MS,
    WORKER_MAX_ATTEMPTS: process.env.WORKER_MAX_ATTEMPTS,
    DASHBOARD_URL: process.env.NEXT_PUBLIC_DASHBOARD_URL,
  });
}
