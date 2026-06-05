import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/worker-queue/keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "@workspace/worker-queue/keys";
import { isBullmqWorkerDisabled } from "./is-bullmq-worker-disabled";

const baseKeys = {
  WORKER_QUEUE_ADAPTER: "bullmq",
  BULLMQ_QUEUE_NAME: "jobs",
  GCP_PROJECT_ID: undefined,
  PUBSUB_TOPIC_NAME: "jobs",
  PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
  SQS_QUEUE_URL: undefined,
  AWS_REGION: undefined,
  SERVICEBUS_CONNECTION_STRING: undefined,
  SERVICEBUS_QUEUE_NAME: "jobs",
} as const;

describe("isBullmqWorkerDisabled", () => {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when adapter is not bullmq", () => {
    expect(isBullmqWorkerDisabled("pubsub")).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("returns false when bullmq has REDIS_URL", () => {
    vi.mocked(keys).mockReturnValue({
      ...baseKeys,
      REDIS_URL: "redis://localhost:6379",
    });

    expect(isBullmqWorkerDisabled("bullmq")).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("returns true in development when bullmq has no REDIS_URL", () => {
    vi.mocked(keys).mockReturnValue({
      ...baseKeys,
      REDIS_URL: undefined,
    });

    expect(isBullmqWorkerDisabled("bullmq")).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 in production when bullmq has no REDIS_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(keys).mockReturnValue({
      ...baseKeys,
      REDIS_URL: undefined,
    });

    expect(() => isBullmqWorkerDisabled("bullmq")).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
