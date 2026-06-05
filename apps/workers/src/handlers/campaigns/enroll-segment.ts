import { prisma } from "@workspace/database";
import { enrollSegmentSnapshot } from "@workspace/campaigns";

export async function handleCampaignEnrollSegment(payload: { campaignRunId: string }) {
  const run = await prisma.emailCampaignRun.findFirst({
    where: { id: payload.campaignRunId },
    select: {
      organizationId: true,
      sequenceId: true,
      segmentId: true,
    },
  });

  if (!run) {
    throw new Error(`Campaign run not found: ${payload.campaignRunId}`);
  }

  await enrollSegmentSnapshot(
    run.organizationId,
    payload.campaignRunId,
    run.sequenceId,
    run.segmentId,
    "system",
  );
}
