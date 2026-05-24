import { createId } from "@workspace/common";
import { prisma } from "@workspace/database";
import { getAiThreadById, touchAiThreadUpdatedAt } from "./ai-thread-repo";

async function requireAiThreadForUser(
  threadId: string,
  organizationId: string,
  userId: string,
) {
  const thread = await getAiThreadById(threadId, organizationId, userId);
  if (!thread) {
    throw new Error(
      `Thread ${threadId} not found or not accessible for user ${userId} in organization ${organizationId}`,
    );
  }
  return thread;
}

export async function listAiMessagesForThread(
  threadId: string,
  organizationId: string,
  userId: string,
) {
  await requireAiThreadForUser(threadId, organizationId, userId);
  return prisma.aiMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createAiUserMessage(
  threadId: string,
  organizationId: string,
  userId: string,
  content: string,
) {
  await requireAiThreadForUser(threadId, organizationId, userId);
  const message = await prisma.aiMessage.create({
    data: {
      id: createId("aimsg"),
      threadId,
      role: "user",
      content,
    },
  });
  await touchAiThreadUpdatedAt(threadId);
  return message;
}

export async function createAiAssistantMessage(
  threadId: string,
  organizationId: string,
  userId: string,
  content: string,
  options?: {
    toolPayload?: unknown;
    metadata?: unknown;
  },
) {
  await requireAiThreadForUser(threadId, organizationId, userId);
  const { toolPayload, metadata } = options ?? {};
  const message = await prisma.aiMessage.create({
    data: {
      id: createId("aimsg"),
      threadId,
      role: "assistant",
      content,
      ...(toolPayload !== undefined && { toolPayload: toolPayload as never }),
      ...(metadata !== undefined && { metadata: metadata as never }),
    },
  });
  await touchAiThreadUpdatedAt(threadId);
  return message;
}

export async function updateAiMessageFeedback(
  messageId: string,
  organizationId: string,
  userId: string,
  feedback: "helpful" | "not_helpful",
  comment?: string,
) {
  const message = await prisma.aiMessage.findFirst({
    where: {
      id: messageId,
      thread: { organizationId, userId },
    },
    include: { thread: true },
  });
  if (!message) {
    throw new Error(
      `Message ${messageId} not found or not accessible for user ${userId} in organization ${organizationId}`,
    );
  }
  if (message.role !== "assistant") {
    throw new Error(
      `Feedback can only be set on assistant messages, but message ${messageId} has role "${message.role}"`,
    );
  }
  return prisma.aiMessage.update({
    where: { id: messageId },
    data: {
      feedback,
      feedbackComment: comment,
    },
  });
}
