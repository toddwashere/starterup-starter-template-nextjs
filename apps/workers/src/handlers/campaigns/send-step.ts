import { executeStepSend } from "@workspace/campaigns";

export async function handleCampaignSendStep(payload: { stepSendId: string }) {
  await executeStepSend(payload.stepSendId);
}
