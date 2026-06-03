import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../keys";
import { resetDisabledAdapterWarning } from "./adapters/disabled";
import { resolveAdapter } from "./resolve-adapter";

const baseKeys = {
  BULLMQ_QUEUE_NAME: "jobs",
  GCP_PROJECT_ID: undefined,
  PUBSUB_TOPIC_NAME: "jobs",
  PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
  SQS_QUEUE_URL: undefined,
  AWS_REGION: undefined,
  SERVICEBUS_CONNECTION_STRING: undefined,
  SERVICEBUS_QUEUE_NAME: "jobs",
} as const;

describe("resolveAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDisabledAdapterWarning();
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to disabled adapter when bullmq is selected without REDIS_URL in development", async () => {
    vi.mocked(keys).mockReturnValue({
      ...baseKeys,
      WORKER_QUEUE_ADAPTER: "bullmq",
      REDIS_URL: undefined,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = resolveAdapter();
    const id = await adapter.publish("jobs", {
      event: "user.welcome-email",
      payload: { userId: "u1" },
    });

    expect(id).toBe("disabled");
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("throws when bullmq is selected without REDIS_URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(keys).mockReturnValue({
      ...baseKeys,
      WORKER_QUEUE_ADAPTER: "bullmq",
      REDIS_URL: undefined,
    });

    expect(() => resolveAdapter()).toThrow(/REDIS_URL/);
  });
});
