import { createId } from "@workspace/common";
import { prisma } from "@workspace/database";

export async function getOrCreateActiveAiThread(
  userId: string,
  organizationId: string,
) {
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

export async function getAiThreadById(
  threadId: string,
  organizationId: string,
  userId: string,
) {
  return prisma.aiThread.findFirst({
    where: { id: threadId, organizationId, userId },
  });
}

export async function listAiThreadsForOrg(
  organizationId: string,
  userId: string,
) {
  return prisma.aiThread.findMany({
    where: { organizationId, userId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function touchAiThreadUpdatedAt(threadId: string) {
  return prisma.aiThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });
}
