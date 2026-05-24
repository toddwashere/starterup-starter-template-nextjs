import { createId } from "@workspace/common";
import { prisma } from "@workspace/database";

// Thread + message persistence for the assistant-chat call. Merged from the
// former @workspace/ai-chat package. All reads/writes are scoped by
// organizationId + userId so a caller can only touch its own threads.

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function getOrCreateActiveThread({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  const existing = await prisma.aiThread.findFirst({
    where: { organizationId, userId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) {
    return existing;
  }
  return prisma.aiThread.create({
    data: {
      id: createId("aith"),
      organizationId,
      userId,
    },
  });
}

export async function getThreadById({
  threadId,
  organizationId,
  userId,
}: {
  threadId: string;
  organizationId: string;
  userId: string;
}) {
  return prisma.aiThread.findFirst({
    where: { id: threadId, organizationId, userId },
  });
}

export async function listThreadsForOrg({
  organizationId,
}: {
  organizationId: string;
}) {
  return prisma.aiThread.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

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
