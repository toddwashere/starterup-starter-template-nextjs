import { describe, expect, it, vi, beforeEach } from "vitest";
import type { JobEnvelope } from "../types";

const addMock = vi.fn();
const queueCtor = vi.fn();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string, opts: unknown) => {
    queueCtor(name, opts);
    return { add: addMock };
  }),
}));

vi.mock("../../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../../keys";
import { createBullmqAdapter } from "./bullmq";

beforeEach(() => {
  vi.clearAllMocks();
});

const envelope: JobEnvelope = {
  event: "user.welcome-email",
  payload: { userId: "u1" },
  enqueuedAt: "2026-05-23T00:00:00.000Z",
};

describe("createBullmqAdapter", () => {
  it("publish() calls queue.add with the envelope event as job name and the full envelope as data", async () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "bullmq",
      BULLMQ_QUEUE_NAME: "jobs",
      REDIS_URL: "redis://localhost:6379",
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
    });
    addMock.mockResolvedValueOnce({ id: "42" });

    const adapter = createBullmqAdapter();
    const id = await adapter.publish("ignored-by-bullmq", envelope);

    expect(id).toBe("42");
    expect(addMock).toHaveBeenCalledTimes(1);
    const [jobName, data, options] = addMock.mock.calls[0]!;
    expect(jobName).toBe("user.welcome-email");
    expect(data).toEqual(envelope);
    expect(options).toMatchObject({
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
    });
  });

  it("throws a clear error when REDIS_URL is missing", () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "bullmq",
      BULLMQ_QUEUE_NAME: "jobs",
      REDIS_URL: undefined,
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
    });
    expect(() => createBullmqAdapter()).toThrow(/REDIS_URL/);
  });

  it("uses BULLMQ_QUEUE_NAME from keys when constructing the Queue", () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "bullmq",
      BULLMQ_QUEUE_NAME: "custom-jobs",
      REDIS_URL: "redis://localhost:6379",
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
    });
    createBullmqAdapter();
    expect(queueCtor).toHaveBeenCalledWith("custom-jobs", expect.any(Object));
  });
});
