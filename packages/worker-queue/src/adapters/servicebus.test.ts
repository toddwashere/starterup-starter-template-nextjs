import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobEnvelope } from "../types";

// --- Mock @azure/service-bus ------------------------------------------------
const sendMessagesMock = vi.fn();
const subscribeMock = vi.fn();
const completeMessageMock = vi.fn();
const abandonMessageMock = vi.fn();
const closeSenderMock = vi.fn();
const closeReceiverMock = vi.fn();
const closeClientMock = vi.fn();

const mockSender = {
  sendMessages: sendMessagesMock,
  close: closeSenderMock,
};

const mockReceiver = {
  subscribe: subscribeMock,
  completeMessage: completeMessageMock,
  abandonMessage: abandonMessageMock,
  close: closeReceiverMock,
};

vi.mock("@azure/service-bus", () => ({
  ServiceBusClient: vi.fn().mockImplementation(() => ({
    createSender: vi.fn().mockReturnValue(mockSender),
    createReceiver: vi.fn().mockReturnValue(mockReceiver),
    close: closeClientMock,
  })),
}));

vi.mock("../../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../../keys";
import { createServiceBusAdapter } from "./servicebus";

const envelope: JobEnvelope = {
  event: "user.welcome-email",
  payload: { userId: "u1" },
  enqueuedAt: "2026-05-29T00:00:00.000Z",
};

const CONNECTION_STRING =
  "Endpoint=sb://starter-sb-sandbox.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=dummykey";

function mockKeys(overrides: Partial<ReturnType<typeof keys>> = {}) {
  vi.mocked(keys).mockReturnValue({
    WORKER_QUEUE_ADAPTER: "servicebus",
    BULLMQ_QUEUE_NAME: "jobs",
    REDIS_URL: undefined,
    GCP_PROJECT_ID: undefined,
    PUBSUB_TOPIC_NAME: "jobs",
    PUBSUB_SUBSCRIPTION_NAME: "jobs-sub",
    SQS_QUEUE_URL: undefined,
    AWS_REGION: undefined,
    SERVICEBUS_CONNECTION_STRING: CONNECTION_STRING,
    SERVICEBUS_QUEUE_NAME: "jobs",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockKeys();
});

describe("createServiceBusAdapter", () => {
  it("throws when SERVICEBUS_CONNECTION_STRING is missing", () => {
    mockKeys({ SERVICEBUS_CONNECTION_STRING: undefined });
    expect(() => createServiceBusAdapter()).toThrow(/SERVICEBUS_CONNECTION_STRING/);
  });
});

describe("createServiceBusAdapter.publish", () => {
  it("sends the envelope body via the sender and returns empty string", async () => {
    sendMessagesMock.mockResolvedValueOnce(undefined);
    const adapter = createServiceBusAdapter();
    const id = await adapter.publish("ignored", envelope);
    expect(id).toBe("");
    expect(sendMessagesMock).toHaveBeenCalledOnce();
    const call = sendMessagesMock.mock.calls[0]![0] as { body: JobEnvelope };
    expect(call.body).toEqual(envelope);
  });

  it("propagates send errors", async () => {
    sendMessagesMock.mockRejectedValueOnce(new Error("network failure"));
    const adapter = createServiceBusAdapter();
    await expect(adapter.publish("ignored", envelope)).rejects.toThrow("network failure");
  });
});

describe("createServiceBusAdapter.consume", () => {
  it("calls completeMessage when handler returns 'ack'", async () => {
    completeMessageMock.mockResolvedValue(undefined);
    const closeSub = vi.fn().mockResolvedValue(undefined);
    closeReceiverMock.mockResolvedValue(undefined);
    closeSenderMock.mockResolvedValue(undefined);
    closeClientMock.mockResolvedValue(undefined);

    subscribeMock.mockImplementation(
      (handlers: {
        processMessage: (msg: unknown) => Promise<void>;
        processError: (args: unknown) => Promise<void>;
      }) => {
        const msg = {
          messageId: "msg-1",
          deliveryCount: 1,
          body: envelope,
        };
        void handlers.processMessage(msg);
        return { close: closeSub };
      },
    );

    const controller = new AbortController();
    const adapter = createServiceBusAdapter();

    const consuming = adapter.consume(
      async () => {
        controller.abort();
        return "ack";
      },
      { signal: controller.signal },
    );

    await consuming;
    expect(completeMessageMock).toHaveBeenCalledOnce();
    expect(closeSub).toHaveBeenCalledOnce();
  });

  it("calls abandonMessage when handler returns 'nack'", async () => {
    abandonMessageMock.mockResolvedValue(undefined);
    const closeSub = vi.fn().mockResolvedValue(undefined);
    closeReceiverMock.mockResolvedValue(undefined);
    closeSenderMock.mockResolvedValue(undefined);
    closeClientMock.mockResolvedValue(undefined);

    subscribeMock.mockImplementation(
      (handlers: {
        processMessage: (msg: unknown) => Promise<void>;
        processError: (args: unknown) => Promise<void>;
      }) => {
        const msg = {
          messageId: "msg-2",
          deliveryCount: 1,
          body: envelope,
        };
        void handlers.processMessage(msg);
        return { close: closeSub };
      },
    );

    const controller = new AbortController();
    const adapter = createServiceBusAdapter();

    await adapter.consume(
      async () => {
        controller.abort();
        return "nack";
      },
      { signal: controller.signal },
    );

    expect(abandonMessageMock).toHaveBeenCalledOnce();
  });

  it("calls abandonMessage when handler throws", async () => {
    abandonMessageMock.mockResolvedValue(undefined);
    const closeSub = vi.fn().mockResolvedValue(undefined);
    closeReceiverMock.mockResolvedValue(undefined);
    closeSenderMock.mockResolvedValue(undefined);
    closeClientMock.mockResolvedValue(undefined);

    subscribeMock.mockImplementation(
      (handlers: {
        processMessage: (msg: unknown) => Promise<void>;
        processError: (args: unknown) => Promise<void>;
      }) => {
        const msg = {
          messageId: "msg-3",
          deliveryCount: 1,
          body: envelope,
        };
        void handlers.processMessage(msg);
        return { close: closeSub };
      },
    );

    const controller = new AbortController();
    const adapter = createServiceBusAdapter();

    await adapter.consume(
      async () => {
        controller.abort();
        throw new Error("handler exploded");
      },
      { signal: controller.signal },
    );

    expect(abandonMessageMock).toHaveBeenCalledOnce();
  });
});
