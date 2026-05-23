import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";

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

export async function listThreadsForOrg({ organizationId }: { organizationId: string }) {
  return prisma.aiThread.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });
}
