import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";
import { getThreadById } from "./ai-thread-repo";

async function requireThreadOwnership({
  threadId,
  organizationId,
  userId,
}: {
  threadId: string;
  organizationId: string;
  userId: string;
}) {
  const thread = await getThreadById({ threadId, organizationId, userId });
  if (!thread) {
    throw new Error(
      `Thread ${threadId} not found or not accessible for user ${userId} in organization ${organizationId}`,
    );
  }
  return thread;
}

export async function listMessagesForThread({
  threadId,
  organizationId,
  userId,
}: {
  threadId: string;
  organizationId: string;
  userId: string;
}) {
  await requireThreadOwnership({ threadId, organizationId, userId });
  return prisma.aiMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });
}

export async function appendUserMessage({
  threadId,
  organizationId,
  userId,
  content,
}: {
  threadId: string;
  organizationId: string;
  userId: string;
  content: string;
}) {
  await requireThreadOwnership({ threadId, organizationId, userId });
  const message = await prisma.aiMessage.create({
    data: {
      id: createId("aimsg"),
      threadId,
      role: "user",
      content,
    },
  });
  await prisma.aiThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });
  return message;
}

export async function appendAssistantMessage({
  threadId,
  organizationId,
  userId,
  content,
  toolPayload,
  metadata,
}: {
  threadId: string;
  organizationId: string;
  userId: string;
  content: string;
  toolPayload?: unknown;
  metadata?: unknown;
}) {
  await requireThreadOwnership({ threadId, organizationId, userId });
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
  await prisma.aiThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });
  return message;
}

export async function setMessageFeedback({
  messageId,
  organizationId,
  userId,
  feedback,
  comment,
}: {
  messageId: string;
  organizationId: string;
  userId: string;
  feedback: "helpful" | "not_helpful";
  comment?: string;
}) {
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
