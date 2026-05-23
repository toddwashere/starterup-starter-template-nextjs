import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    aiThread: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiMessage: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import {
  listMessagesForThread,
  appendUserMessage,
  appendAssistantMessage,
  setMessageFeedback,
} from "./ai-message-repo";

beforeEach(() => vi.clearAllMocks());

const makeThread = (overrides = {}) => ({
  id: "aith_abc",
  organizationId: "org_1",
  userId: "user_1",
  title: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("listMessagesForThread", () => {
  it("returns messages ordered by createdAt asc after verifying thread ownership", async () => {
    const thread = makeThread();
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(thread as never);
    vi.mocked(prisma.aiMessage.findMany).mockResolvedValue([]);

    await listMessagesForThread({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
    });

    expect(prisma.aiThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "aith_abc", organizationId: "org_1", userId: "user_1" },
      }),
    );
    expect(prisma.aiMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId: "aith_abc" },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("throws when thread is not found (cross-org access denied)", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(null);

    await expect(
      listMessagesForThread({
        threadId: "aith_abc",
        organizationId: "org_other",
        userId: "user_other",
      }),
    ).rejects.toThrow();

    expect(prisma.aiMessage.findMany).not.toHaveBeenCalled();
  });
});

describe("appendUserMessage", () => {
  it("creates an AiMessage with role user and aimsg_ prefixed id after ownership check", async () => {
    const thread = makeThread();
    const message = {
      id: "aimsg_new",
      threadId: "aith_abc",
      role: "user",
      content: "Hello",
      toolPayload: null,
      feedback: null,
      feedbackComment: null,
      metadata: null,
      createdAt: new Date(),
    };
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(thread as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue(message as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(thread as never);

    const result = await appendUserMessage({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
      content: "Hello",
    });

    expect(prisma.aiThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "aith_abc", organizationId: "org_1", userId: "user_1" },
      }),
    );
    expect(prisma.aiMessage.create).toHaveBeenCalledOnce();
    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.id).toMatch(/^aimsg_/);
    expect(createCall?.data.role).toBe("user");
    expect(createCall?.data.threadId).toBe("aith_abc");
    expect(createCall?.data.content).toBe("Hello");
    expect(result).toEqual(message);
  });

  it("throws when thread ownership check fails", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(null);

    await expect(
      appendUserMessage({
        threadId: "aith_abc",
        organizationId: "org_other",
        userId: "user_other",
        content: "Hello",
      }),
    ).rejects.toThrow();

    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });
});

describe("appendAssistantMessage", () => {
  it("creates an AiMessage with role assistant persisting toolPayload and metadata", async () => {
    const thread = makeThread();
    const toolPayload = [{ type: "tool_result", id: "tr_1" }];
    const metadata = { langfuseTraceId: "trace_abc" };
    const message = {
      id: "aimsg_asst",
      threadId: "aith_abc",
      role: "assistant",
      content: "I can help with that.",
      toolPayload,
      feedback: null,
      feedbackComment: null,
      metadata,
      createdAt: new Date(),
    };
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(thread as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue(message as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(thread as never);

    const result = await appendAssistantMessage({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
      content: "I can help with that.",
      toolPayload,
      metadata,
    });

    expect(prisma.aiMessage.create).toHaveBeenCalledOnce();
    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.id).toMatch(/^aimsg_/);
    expect(createCall?.data.role).toBe("assistant");
    expect(createCall?.data.toolPayload).toEqual(toolPayload);
    expect(createCall?.data.metadata).toEqual(metadata);
    expect(result).toEqual(message);
  });

  it("creates an assistant message without optional fields when not provided", async () => {
    const thread = makeThread();
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(thread as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({} as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(thread as never);

    await appendAssistantMessage({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
      content: "Response",
    });

    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.role).toBe("assistant");
    expect(createCall?.data.toolPayload).toBeUndefined();
    expect(createCall?.data.metadata).toBeUndefined();
  });
});

describe("setMessageFeedback", () => {
  it("updates feedback on an assistant message scoped to an owned thread", async () => {
    const thread = makeThread();
    const assistantMessage = {
      id: "aimsg_asst",
      threadId: "aith_abc",
      role: "assistant",
      content: "I can help.",
      thread: thread,
    };
    vi.mocked(prisma.aiMessage.findFirst).mockResolvedValue(assistantMessage as never);
    vi.mocked(prisma.aiMessage.update).mockResolvedValue({ ...assistantMessage, feedback: "helpful" } as never);

    await setMessageFeedback({
      messageId: "aimsg_asst",
      organizationId: "org_1",
      userId: "user_1",
      feedback: "helpful",
      comment: "Very useful!",
    });

    expect(prisma.aiMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "aimsg_asst",
          thread: { organizationId: "org_1", userId: "user_1" },
        }),
      }),
    );
    expect(prisma.aiMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "aimsg_asst" },
        data: expect.objectContaining({
          feedback: "helpful",
          feedbackComment: "Very useful!",
        }),
      }),
    );
  });

  it("throws when trying to set feedback on a user message", async () => {
    const thread = makeThread();
    const userMessage = {
      id: "aimsg_usr",
      threadId: "aith_abc",
      role: "user",
      content: "Hello",
      thread: thread,
    };
    vi.mocked(prisma.aiMessage.findFirst).mockResolvedValue(userMessage as never);

    await expect(
      setMessageFeedback({
        messageId: "aimsg_usr",
        organizationId: "org_1",
        userId: "user_1",
        feedback: "helpful",
      }),
    ).rejects.toThrow();

    expect(prisma.aiMessage.update).not.toHaveBeenCalled();
  });

  it("throws when message is not found (cross-org access denied)", async () => {
    vi.mocked(prisma.aiMessage.findFirst).mockResolvedValue(null);

    await expect(
      setMessageFeedback({
        messageId: "aimsg_asst",
        organizationId: "org_other",
        userId: "user_other",
        feedback: "not_helpful",
      }),
    ).rejects.toThrow();

    expect(prisma.aiMessage.update).not.toHaveBeenCalled();
  });
});
