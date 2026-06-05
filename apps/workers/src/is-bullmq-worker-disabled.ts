import { keys as queueKeys } from "@workspace/worker-queue/keys";

/**
 * True when BullMQ is configured but Redis is unavailable.
 * In production this is a fatal misconfiguration; in dev the worker stays idle.
 */
export function isBullmqWorkerDisabled(adapterName: string): boolean {
  if (adapterName !== "bullmq") {
    return false;
  }

  const { REDIS_URL } = queueKeys();
  if (REDIS_URL) {
    return false;
  }

  console.warn(
    "[workers] REDIS_URL not set; background worker disabled (dev only)",
  );

  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }

  return true;
}
