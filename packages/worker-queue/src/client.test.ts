import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../keys";
import { syncAdapter } from "./adapters/sync";
import { enqueue } from "./client";

describe("enqueue (sync adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncAdapter.reset();
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "sync",
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
  });

  it("records a published message and returns a string id", async () => {
    const id = await enqueue("user.welcome-email", { userId: "u1" });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    expect(syncAdapter.published).toHaveLength(1);
    const entry = syncAdapter.published[0]!;
    expect(entry.queue).toBe("jobs");
    expect(entry.envelope.event).toBe("user.welcome-email");
    expect(entry.envelope.payload).toEqual({ userId: "u1" });
  });

  it("sets enqueuedAt to a valid ISO timestamp", async () => {
    await enqueue("user.welcome-email", { userId: "u1" });

    const { enqueuedAt } = syncAdapter.published[0]!.envelope;
    expect(typeof enqueuedAt).toBe("string");
    expect(enqueuedAt).toBe(new Date(enqueuedAt!).toISOString());
  });

  it("includes idempotencyKey on the envelope when provided", async () => {
    await enqueue(
      "user.welcome-email",
      { userId: "u1" },
      { idempotencyKey: "key-1" },
    );

    expect(syncAdapter.published[0]!.envelope.idempotencyKey).toBe("key-1");
  });

  it("forwards delayMs to the adapter", async () => {
    await enqueue(
      "campaign.send-step",
      { stepSendId: "esend_1" },
      { delayMs: 60_000, idempotencyKey: "enrl:step" },
    );

    expect(syncAdapter.published[0]!.options).toEqual({
      delayMs: 60_000,
      jobId: "enrl:step",
    });
  });

  it("omits idempotencyKey from the envelope when not provided", async () => {
    await enqueue("user.welcome-email", { userId: "u1" });

    expect(syncAdapter.published[0]!.envelope).not.toHaveProperty(
      "idempotencyKey",
    );
  });

  it("uses BULLMQ_QUEUE_NAME from keys for the queue argument", async () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "sync",
      BULLMQ_QUEUE_NAME: "custom-queue",
      REDIS_URL: undefined,
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
      SQS_QUEUE_URL: undefined,
      AWS_REGION: undefined,
      SERVICEBUS_CONNECTION_STRING: undefined,
      SERVICEBUS_QUEUE_NAME: "jobs",
    });

    await enqueue("user.welcome-email", { userId: "u1" });

    expect(syncAdapter.published[0]!.queue).toBe("custom-queue");
  });

  it("validates a malformed payload BEFORE touching the adapter", async () => {
    await expect(
      // @ts-expect-error intentionally invalid payload
      enqueue("user.welcome-email", {}),
    ).rejects.toThrow();

    expect(syncAdapter.published).toHaveLength(0);
  });

  it("rejects an unknown event name before touching the adapter", async () => {
    await expect(
      // @ts-expect-error intentionally unknown event
      enqueue("does.not.exist", {}),
    ).rejects.toThrow();

    expect(syncAdapter.published).toHaveLength(0);
  });

  it("handles webhook.deliver happy path", async () => {
    await enqueue("webhook.deliver", { deliveryId: "d1" });

    expect(syncAdapter.published[0]!.envelope).toMatchObject({
      event: "webhook.deliver",
      payload: { deliveryId: "d1" },
    });
  });

  it("handles cleanup.expired-sessions happy path", async () => {
    await enqueue("cleanup.expired-sessions", {});

    expect(syncAdapter.published[0]!.envelope).toMatchObject({
      event: "cleanup.expired-sessions",
      payload: {},
    });
  });
});
