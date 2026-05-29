import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobEnvelope } from "../types";

const publishMessageMock = vi.fn();
const onMock = vi.fn();
const closeMock = vi.fn();
const removeAllListenersMock = vi.fn();
const subscriptionMock = {
  on: onMock,
  close: closeMock,
  removeAllListeners: removeAllListenersMock,
};

const pubsubCtor = vi.fn();
const topicCtor = vi.fn();
const subscriptionCtor = vi.fn();

vi.mock("@google-cloud/pubsub", () => ({
  PubSub: vi.fn().mockImplementation((opts: unknown) => {
    pubsubCtor(opts);
    return {
      topic: vi.fn().mockImplementation((name: string) => {
        topicCtor(name);
        return { publishMessage: publishMessageMock };
      }),
      subscription: vi.fn().mockImplementation((name: string) => {
        subscriptionCtor(name);
        return subscriptionMock;
      }),
    };
  }),
}));

vi.mock("../../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../../keys";
import { createPubsubAdapter } from "./pubsub";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(keys).mockReturnValue({
    WORKER_QUEUE_ADAPTER: "pubsub",
    BULLMQ_QUEUE_NAME: "jobs",
    REDIS_URL: undefined,
    GCP_PROJECT_ID: "my-project",
    PUBSUB_TOPIC_NAME: "jobs",
    PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
    SQS_QUEUE_URL: undefined,
    AWS_REGION: undefined,
    SERVICEBUS_CONNECTION_STRING: undefined,
    SERVICEBUS_QUEUE_NAME: "jobs",
  });
});

const envelope: JobEnvelope = {
  event: "user.welcome-email",
  payload: { userId: "u1" },
  enqueuedAt: "2026-05-23T00:00:00.000Z",
};

describe("createPubsubAdapter.publish", () => {
  it("publishes the JSON-serialized envelope and returns the message id", async () => {
    publishMessageMock.mockResolvedValueOnce("msg-42");
    const adapter = createPubsubAdapter();
    const id = await adapter.publish("ignored", envelope);
    expect(id).toBe("msg-42");
    expect(publishMessageMock).toHaveBeenCalledTimes(1);
    const [arg] = publishMessageMock.mock.calls[0]!;
    expect(arg.data).toBeInstanceOf(Buffer);
    expect(JSON.parse(arg.data.toString("utf8"))).toEqual(envelope);
  });

  it("throws when GCP_PROJECT_ID is missing", () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "pubsub",
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
    expect(() => createPubsubAdapter()).toThrow(/GCP_PROJECT_ID/);
  });

  it("uses configured topic + subscription names", () => {
    createPubsubAdapter();
    expect(topicCtor).toHaveBeenCalledWith("jobs");
    expect(subscriptionCtor).toHaveBeenCalledWith("jobs-sub");
  });
});

describe("createPubsubAdapter.consume", () => {
  it("acks on handler success", async () => {
    const ackMock = vi.fn();
    const nackMock = vi.fn();
    let messageHandler: (msg: any) => void = () => {};
    onMock.mockImplementation((event: string, handler: any) => {
      if (event === "message") messageHandler = handler;
    });

    const adapter = createPubsubAdapter();
    const controller = new AbortController();
    const consuming = adapter.consume(async () => "ack", { signal: controller.signal });

    // Let the promise set up listeners
    await Promise.resolve();

    messageHandler({
      id: "m1",
      data: Buffer.from(JSON.stringify(envelope)),
      deliveryAttempt: 1,
      ack: ackMock,
      nack: nackMock,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(ackMock).toHaveBeenCalledTimes(1);
    expect(nackMock).not.toHaveBeenCalled();

    closeMock.mockResolvedValue(undefined);
    controller.abort();
    await consuming;
  });

  it("nacks on handler return 'nack'", async () => {
    const ackMock = vi.fn();
    const nackMock = vi.fn();
    let messageHandler: (msg: any) => void = () => {};
    onMock.mockImplementation((event: string, handler: any) => {
      if (event === "message") messageHandler = handler;
    });

    const adapter = createPubsubAdapter();
    const controller = new AbortController();
    const consuming = adapter.consume(async () => "nack", { signal: controller.signal });

    await Promise.resolve();

    messageHandler({
      id: "m2",
      data: Buffer.from(JSON.stringify(envelope)),
      deliveryAttempt: 1,
      ack: ackMock,
      nack: nackMock,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(nackMock).toHaveBeenCalledTimes(1);
    expect(ackMock).not.toHaveBeenCalled();

    closeMock.mockResolvedValue(undefined);
    controller.abort();
    await consuming;
  });

  it("nacks on handler throw", async () => {
    const ackMock = vi.fn();
    const nackMock = vi.fn();
    let messageHandler: (msg: any) => void = () => {};
    onMock.mockImplementation((event: string, handler: any) => {
      if (event === "message") messageHandler = handler;
    });

    const adapter = createPubsubAdapter();
    const controller = new AbortController();
    const consuming = adapter.consume(
      async () => { throw new Error("handler exploded"); },
      { signal: controller.signal },
    );

    await Promise.resolve();

    messageHandler({
      id: "m3",
      data: Buffer.from(JSON.stringify(envelope)),
      deliveryAttempt: 1,
      ack: ackMock,
      nack: nackMock,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(nackMock).toHaveBeenCalledTimes(1);
    expect(ackMock).not.toHaveBeenCalled();

    closeMock.mockResolvedValue(undefined);
    controller.abort();
    await consuming;
  });

  it("acks poison messages (unparseable JSON) without calling onMessage", async () => {
    const ackMock = vi.fn();
    const nackMock = vi.fn();
    const onMessageMock = vi.fn();
    let messageHandler: (msg: any) => void = () => {};
    onMock.mockImplementation((event: string, handler: any) => {
      if (event === "message") messageHandler = handler;
    });

    const adapter = createPubsubAdapter();
    const controller = new AbortController();
    const consuming = adapter.consume(onMessageMock, { signal: controller.signal });

    await Promise.resolve();

    messageHandler({
      id: "m4",
      data: Buffer.from("not-valid-json"),
      deliveryAttempt: 1,
      ack: ackMock,
      nack: nackMock,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(ackMock).toHaveBeenCalledTimes(1);
    expect(nackMock).not.toHaveBeenCalled();
    expect(onMessageMock).not.toHaveBeenCalled();

    closeMock.mockResolvedValue(undefined);
    controller.abort();
    await consuming;
  });
});
