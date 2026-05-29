import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobEnvelope } from "../types";

// --- Mock @aws-sdk/client-sqs -----------------------------------------------
const sendMock = vi.fn();

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  SendMessageCommand: vi.fn().mockImplementation((input) => ({ _type: "SendMessage", input })),
  ReceiveMessageCommand: vi.fn().mockImplementation((input) => ({
    _type: "ReceiveMessage",
    input,
  })),
  DeleteMessageCommand: vi.fn().mockImplementation((input) => ({ _type: "Delete", input })),
  ChangeMessageVisibilityCommand: vi.fn().mockImplementation((input) => ({
    _type: "ChangeVisibility",
    input,
  })),
}));

vi.mock("../../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../../keys";
import { createSqsAdapter } from "./sqs";

const envelope: JobEnvelope = {
  event: "user.welcome-email",
  payload: { userId: "u1" },
  enqueuedAt: "2026-05-29T00:00:00.000Z",
};

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789/starter-jobs-sandbox";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(keys).mockReturnValue({
    WORKER_QUEUE_ADAPTER: "sqs",
    BULLMQ_QUEUE_NAME: "jobs",
    REDIS_URL: undefined,
    GCP_PROJECT_ID: undefined,
    PUBSUB_TOPIC_NAME: "jobs",
    PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
    SQS_QUEUE_URL: QUEUE_URL,
    AWS_REGION: "us-east-1",
    SERVICEBUS_CONNECTION_STRING: undefined,
    SERVICEBUS_QUEUE_NAME: "jobs",
  });
});

describe("createSqsAdapter.publish", () => {
  it("sends the JSON-serialized envelope and returns the MessageId", async () => {
    sendMock.mockResolvedValueOnce({ MessageId: "msg-1" });
    const adapter = createSqsAdapter();
    const id = await adapter.publish("ignored", envelope);
    expect(id).toBe("msg-1");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0]![0] as { input: { QueueUrl: string; MessageBody: string } };
    expect(cmd.input.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(cmd.input.MessageBody)).toEqual(envelope);
  });

  it("returns empty string when MessageId is absent", async () => {
    sendMock.mockResolvedValueOnce({});
    const adapter = createSqsAdapter();
    const id = await adapter.publish("ignored", envelope);
    expect(id).toBe("");
  });

  it("throws when SQS_QUEUE_URL is missing", () => {
    vi.mocked(keys).mockReturnValue({
      WORKER_QUEUE_ADAPTER: "sqs",
      BULLMQ_QUEUE_NAME: "jobs",
      REDIS_URL: undefined,
      GCP_PROJECT_ID: undefined,
      PUBSUB_TOPIC_NAME: "jobs",
      PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
      SQS_QUEUE_URL: undefined,
      AWS_REGION: "us-east-1",
      SERVICEBUS_CONNECTION_STRING: undefined,
      SERVICEBUS_QUEUE_NAME: "jobs",
    });
    expect(() => createSqsAdapter()).toThrow(/SQS_QUEUE_URL/);
  });
});

describe("createSqsAdapter.consume", () => {
  it("acks (deletes) when handler returns 'ack'", async () => {
    // First receive returns a message; subsequent receives return empty to drain
    sendMock
      .mockResolvedValueOnce({
        Messages: [
          { MessageId: "m1", ReceiptHandle: "rh1", Body: JSON.stringify(envelope) },
        ],
      })
      .mockResolvedValue({ Messages: [] });

    const controller = new AbortController();
    const adapter = createSqsAdapter();

    let callCount = 0;
    const consuming = adapter.consume(
      async () => {
        callCount++;
        controller.abort(); // stop after first message
        return "ack";
      },
      { signal: controller.signal },
    );

    await consuming;
    expect(callCount).toBe(1);
    // Find the Delete call
    const deleteCalls = sendMock.mock.calls.filter(
      ([cmd]) => (cmd as { _type: string })._type === "Delete",
    );
    expect(deleteCalls).toHaveLength(1);
  });

  it("changes visibility to 0 (nack) when handler returns 'nack'", async () => {
    sendMock
      .mockResolvedValueOnce({
        Messages: [
          { MessageId: "m2", ReceiptHandle: "rh2", Body: JSON.stringify(envelope) },
        ],
      })
      .mockResolvedValue({ Messages: [] });

    const controller = new AbortController();
    const adapter = createSqsAdapter();

    const consuming = adapter.consume(
      async () => {
        controller.abort();
        return "nack";
      },
      { signal: controller.signal },
    );

    await consuming;
    const visCalls = sendMock.mock.calls.filter(
      ([cmd]) => (cmd as { _type: string })._type === "ChangeVisibility",
    );
    expect(visCalls).toHaveLength(1);
    const cmd = visCalls[0]![0] as { input: { VisibilityTimeout: number } };
    expect(cmd.input.VisibilityTimeout).toBe(0);
  });

  it("deletes poison messages (unparseable JSON) without calling onMessage", async () => {
    sendMock
      .mockResolvedValueOnce({
        Messages: [{ MessageId: "m3", ReceiptHandle: "rh3", Body: "not-valid-json{{" }],
      })
      .mockResolvedValue({ Messages: [] });

    const controller = new AbortController();
    const onMessageMock = vi.fn();
    const adapter = createSqsAdapter();

    // Abort after first empty receive
    let receiveCount = 0;
    sendMock.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === "ReceiveMessage") {
        receiveCount++;
        if (receiveCount === 1) {
          return Promise.resolve({
            Messages: [{ MessageId: "m3", ReceiptHandle: "rh3", Body: "not-valid-json{{" }],
          });
        }
        controller.abort();
        return Promise.resolve({ Messages: [] });
      }
      return Promise.resolve({}); // delete
    });

    const consuming = adapter.consume(onMessageMock, { signal: controller.signal });
    await consuming;

    expect(onMessageMock).not.toHaveBeenCalled();
    const deleteCalls = sendMock.mock.calls.filter(
      ([cmd]) => (cmd as { _type: string })._type === "Delete",
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("changes visibility to 0 when handler throws", async () => {
    const controller = new AbortController();
    const adapter = createSqsAdapter();

    let receiveCount = 0;
    sendMock.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === "ReceiveMessage") {
        receiveCount++;
        if (receiveCount === 1) {
          // Return a message on first poll; do NOT abort yet so the loop processes it
          return Promise.resolve({
            Messages: [{ MessageId: "m4", ReceiptHandle: "rh4", Body: JSON.stringify(envelope) }],
          });
        }
        // Second poll: abort and return empty
        controller.abort();
        return Promise.resolve({ Messages: [] });
      }
      // ChangeVisibility call (or anything else)
      return Promise.resolve({});
    });

    const consuming = adapter.consume(
      async () => {
        throw new Error("handler exploded");
      },
      { signal: controller.signal },
    );

    await consuming;
    const visCalls = sendMock.mock.calls.filter(
      ([cmd]) => (cmd as { _type: string })._type === "ChangeVisibility",
    );
    expect(visCalls).toHaveLength(1);
  });
});
