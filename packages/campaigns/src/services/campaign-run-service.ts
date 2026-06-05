import { enqueue } from "@workspace/worker-queue";
import {
  createEmailCampaignRun,
  getEmailCampaignRunById,
  updateEmailCampaignRun,
} from "../data-models/email-campaign-run-repo";
import { getEmailSequenceById, updateEmailSequence } from "../data-models/email-sequence-repo";

export async function startCampaignRun(
  organizationId: string,
  sequenceId: string,
  segmentId: string,
  userId: string,
) {
  const sequence = await getEmailSequenceById(sequenceId, organizationId);
  if (!sequence) {
    throw new Error("Sequence not found in this organization");
  }
  if (sequence.kind !== "campaign") {
    throw new Error("Only campaign sequences can be started as a campaign run");
  }

  const run = await createEmailCampaignRun(organizationId, {
    sequenceId,
    segmentId,
    status: "running",
  });

  await updateEmailSequence(sequenceId, organizationId, { status: "active" });

  await enqueue("campaign.enroll-segment", { campaignRunId: run.id });

  return run;
}

export async function pauseCampaignRun(campaignRunId: string, organizationId: string) {
  const run = await getEmailCampaignRunById(campaignRunId, organizationId);
  if (!run) {
    throw new Error("Campaign run not found in this organization");
  }

  await updateEmailCampaignRun(campaignRunId, organizationId, { status: "paused" });
  await updateEmailSequence(run.sequenceId, organizationId, { status: "paused" });
  return run;
}

export async function cancelCampaignRun(campaignRunId: string, organizationId: string) {
  const run = await getEmailCampaignRunById(campaignRunId, organizationId);
  if (!run) {
    throw new Error("Campaign run not found in this organization");
  }

  await updateEmailCampaignRun(campaignRunId, organizationId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  await updateEmailSequence(run.sequenceId, organizationId, { status: "archived" });
  return run;
}

export async function pauseCampaignSequence(sequenceId: string, organizationId: string) {
  return updateEmailSequence(sequenceId, organizationId, { status: "paused" });
}
