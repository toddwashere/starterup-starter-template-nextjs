import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/worker-queue/keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "@workspace/worker-queue/keys";
import { exitIfBullmqWithoutRedis } from "./exit-if-bullmq-without-redis";

describe("exitIfBullmqWithoutRedis", () => {
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

  it("does nothing when adapter is not bullmq", () => {
    exitIfBullmqWithoutRedis("pubsub");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does nothing when bullmq has REDIS_URL", () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "bullmq",
      BULLMQ_QUEUE_NAME: "jobs",
      REDIS_URL: "redis://localhost:6379",
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
      SQS_QUEUE_URL: undefined,
      AWS_REGION: undefined,
      SERVICEBUS_CONNECTION_STRING: undefined,
      SERVICEBUS_QUEUE_NAME: "jobs",
    });

    exitIfBullmqWithoutRedis("bullmq");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 0 in development when bullmq has no REDIS_URL", () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "bullmq",
      BULLMQ_QUEUE_NAME: "jobs",
      REDIS_URL: undefined,
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
      SQS_QUEUE_URL: undefined,
      AWS_REGION: undefined,
      SERVICEBUS_CONNECTION_STRING: undefined,
      SERVICEBUS_QUEUE_NAME: "jobs",
    });

    expect(() => exitIfBullmqWithoutRedis("bullmq")).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 1 in production when bullmq has no REDIS_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "bullmq",
      BULLMQ_QUEUE_NAME: "jobs",
      REDIS_URL: undefined,
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
      SQS_QUEUE_URL: undefined,
      AWS_REGION: undefined,
      SERVICEBUS_CONNECTION_STRING: undefined,
      SERVICEBUS_QUEUE_NAME: "jobs",
    });

    expect(() => exitIfBullmqWithoutRedis("bullmq")).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
