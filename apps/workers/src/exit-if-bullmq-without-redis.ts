import { keys as queueKeys } from "@workspace/worker-queue/keys";

/** Exit cleanly when BullMQ is configured but Redis is unavailable. */
export function exitIfBullmqWithoutRedis(adapterName: string): void {
  if (adapterName !== "bullmq") {
    return;
  }

  const { REDIS_URL } = queueKeys();
  if (REDIS_URL) {
    return;
  }

  console.warn(
    "[workers] REDIS_URL not set; background worker disabled (dev only)",
  );

  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }

  process.exit(0);
}
