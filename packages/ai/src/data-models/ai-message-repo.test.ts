import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    aiThread: {
      findFirst: vi.fn(),
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
  createAiAssistantMessage,
  createAiUserMessage,
  listAiMessagesForThread,
  updateAiMessageFeedback,
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

describe("listAiMessagesForThread", () => {
  it("returns messages ordered by createdAt asc after verifying thread ownership", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.findMany).mockResolvedValue([]);

    await listAiMessagesForThread("aith_abc", "org_1", "user_1");

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
      listAiMessagesForThread("aith_abc", "org_other", "user_other"),
    ).rejects.toThrow();

    expect(prisma.aiMessage.findMany).not.toHaveBeenCalled();
  });
});

describe("createAiUserMessage", () => {
  it("creates an AiMessage with role user and aimsg_ prefixed id after ownership check", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({ id: "aimsg_new" } as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(makeThread() as never);

    await createAiUserMessage("aith_abc", "org_1", "user_1", "Hello");

    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.id).toMatch(/^aimsg_/);
    expect(createCall?.data.role).toBe("user");
    expect(createCall?.data.content).toBe("Hello");
  });

  it("throws when thread ownership check fails", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(null);

    await expect(
      createAiUserMessage("aith_abc", "org_other", "user_other", "Hello"),
    ).rejects.toThrow();

    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });
});

describe("createAiAssistantMessage", () => {
  it("persists toolPayload and metadata when provided", async () => {
    const toolPayload = [{ type: "tool_result", id: "tr_1" }];
    const metadata = { providerModel: "openrouter:anthropic/claude-sonnet-4" };
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({ id: "aimsg_asst" } as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(makeThread() as never);

    await createAiAssistantMessage(
      "aith_abc",
      "org_1",
      "user_1",
      "I can help with that.",
      { toolPayload, metadata },
    );

    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.role).toBe("assistant");
    expect(createCall?.data.toolPayload).toEqual(toolPayload);
    expect(createCall?.data.metadata).toEqual(metadata);
  });

  it("omits optional fields when not provided", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(makeThread() as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({} as never);
    vi.mocked(prisma.aiThread.update).mockResolvedValue(makeThread() as never);

    await createAiAssistantMessage("aith_abc", "org_1", "user_1", "Response");

    const createCall = vi.mocked(prisma.aiMessage.create).mock.calls[0]?.[0];
    expect(createCall?.data.toolPayload).toBeUndefined();
    expect(createCall?.data.metadata).toBeUndefined();
  });
});

describe("updateAiMessageFeedback", () => {
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

    await updateAiMessageFeedback(
      "aimsg_asst",
      "org_1",
      "user_1",
      "helpful",
      "Very useful!",
    );

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
      updateAiMessageFeedback("aimsg_usr", "org_1", "user_1", "helpful"),
    ).rejects.toThrow();

    expect(prisma.aiMessage.update).not.toHaveBeenCalled();
  });

  it("throws when message is not found (cross-org access denied)", async () => {
    vi.mocked(prisma.aiMessage.findFirst).mockResolvedValue(null);

    await expect(
      updateAiMessageFeedback("aimsg_asst", "org_other", "user_other", "not_helpful"),
    ).rejects.toThrow();

    expect(prisma.aiMessage.update).not.toHaveBeenCalled();
  });
});
