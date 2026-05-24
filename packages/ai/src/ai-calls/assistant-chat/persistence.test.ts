import { beforeEach, describe, expect, it, vi } from "vitest";

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
  appendAssistantMessage,
  appendUserMessage,
  getOrCreateActiveThread,
  getThreadById,
  listMessagesForThread,
  listThreadsForOrg,
  setMessageFeedback,
} from "./persistence";

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

describe("getOrCreateActiveThread", () => {
  it("returns the existing most-recently-updated thread when one exists", async () => {
    const existingThread = makeThread({ id: "aith_existing" });
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(existingThread as never);

    const result = await getOrCreateActiveThread({
      userId: "user_1",
      organizationId: "org_1",
    });

    expect(prisma.aiThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", userId: "user_1" },
        orderBy: { updatedAt: "desc" },
      }),
    );
    expect(prisma.aiThread.create).not.toHaveBeenCalled();
    expect(result).toEqual(existingThread);
  });

  it("creates a new thread with aith_ prefixed id when none exists", async () => {
    const newThread = makeThread({ id: "aith_new" });
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.aiThread.create).mockResolvedValue(newThread as never);

    const result = await getOrCreateActiveThread({
      userId: "user_1",
      organizationId: "org_1",
    });

    expect(prisma.aiThread.create).toHaveBeenCalledOnce();
    const createCall = vi.mocked(prisma.aiThread.create).mock.calls[0]?.[0];
    expect(createCall?.data.id).toMatch(/^aith_/);
    expect(createCall?.data.userId).toBe("user_1");
    expect(createCall?.data.organizationId).toBe("org_1");
    expect(result).toEqual(newThread);
  });
});

describe("getThreadById", () => {
  it("returns the thread when it belongs to the given org and user", async () => {
    const thread = makeThread();
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(thread as never);

    const result = await getThreadById({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
    });

    expect(prisma.aiThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "aith_abc", organizationId: "org_1", userId: "user_1" },
      }),
    );
    expect(result).toEqual(thread);
  });

  it("returns null when org/user does not match (ownership enforced)", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(null);

    const result = await getThreadById({
      threadId: "aith_abc",
      organizationId: "org_other",
      userId: "user_other",
    });

    expect(result).toBeNull();
  });
});

describe("listThreadsForOrg", () => {
  it("returns all threads scoped to the organizationId ordered by updatedAt desc", async () => {
    vi.mocked(prisma.aiThread.findMany).mockResolvedValue([]);

    await listThreadsForOrg({ organizationId: "org_1" });

    expect(prisma.aiThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1" },
        orderBy: { updatedAt: "desc" },
      }),
    );
  });
});

describe("listMessagesForThread", () => {
  it("returns messages ordered by createdAt asc after verifying thread ownership", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.findMany).mockResolvedValue([]);

    await listMessagesForThread({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
    });

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
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({ id: "aimsg_new" } as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(makeThread() as never);

    await appendUserMessage({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
      content: "Hello",
    });

    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.id).toMatch(/^aimsg_/);
    expect(createCall?.data.role).toBe("user");
    expect(createCall?.data.content).toBe("Hello");
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
  it("persists toolPayload and metadata when provided", async () => {
    const toolPayload = [{ type: "tool_result", id: "tr_1" }];
    const metadata = { providerModel: "openrouter:anthropic/claude-sonnet-4" };
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({ id: "aimsg_asst" } as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(makeThread() as never);

    await appendAssistantMessage({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
      content: "I can help with that.",
      toolPayload,
      metadata,
    });

    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.role).toBe("assistant");
    expect(createCall?.data.toolPayload).toEqual(toolPayload);
    expect(createCall?.data.metadata).toEqual(metadata);
  });

  it("omits optional fields when not provided", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({} as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(makeThread() as never);

    await appendAssistantMessage({
      threadId: "aith_abc",
      organizationId: "org_1",
      userId: "user_1",
      content: "Response",
    });

    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.toolPayload).toBeUndefined();
    expect(createCall?.data.metadata).toBeUndefined();
  });
});

describe("setMessageFeedback", () => {
  it("updates feedback on an assistant message scoped to an owned thread", async () => {
    const assistantMessage = {
      id: "aimsg_asst",
      threadId: "aith_abc",
      role: "assistant",
      content: "I can help.",
      thread: makeThread(),
    };
    vi.mocked(prisma.aiMessage.findFirst).mockResolvedValue(assistantMessage as never);
    vi.mocked(prisma.aiMessage.update).mockResolvedValue(assistantMessage as never);

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
    vi.mocked(prisma.aiMessage.findFirst).mockResolvedValue({
      id: "aimsg_usr",
      role: "user",
      thread: makeThread(),
    } as never);

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
