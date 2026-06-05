import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";
import type { CampaignRunStatus } from "../schemas/sequence-schemas";

export async function createEmailCampaignRun(
  organizationId: string,
  data: {
    sequenceId: string;
    segmentId: string;
    status?: CampaignRunStatus;
  },
) {
  return prisma.emailCampaignRun.create({
    data: {
      id: createId("ecrun"),
      organizationId,
      sequenceId: data.sequenceId,
      segmentId: data.segmentId,
      status: data.status ?? "running",
    },
  });
}

export async function getEmailCampaignRunById(campaignRunId: string, organizationId: string) {
  return prisma.emailCampaignRun.findFirst({
    where: { id: campaignRunId, organizationId },
    include: { sequence: { include: { steps: { orderBy: { sortOrder: "asc" } } } } },
  });
}


export async function getLatestCampaignRunForSequence(
  sequenceId: string,
  organizationId: string,
) {
  return prisma.emailCampaignRun.findFirst({
    where: { sequenceId, organizationId },
    orderBy: { startedAt: "desc" },
  });
}

export async function updateEmailCampaignRun(
  campaignRunId: string,
  organizationId: string,
  data: {
    status?: CampaignRunStatus;
    enrolledCount?: number;
    completedAt?: Date | null;
  },
) {
  return prisma.emailCampaignRun.update({
    where: { id: campaignRunId, organizationId },
    data,
  });
}
