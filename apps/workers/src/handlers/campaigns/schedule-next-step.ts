import { scheduleNextStep } from "@workspace/campaigns";

export async function handleCampaignScheduleNextStep(payload: { enrollmentId: string }) {
  await scheduleNextStep(payload.enrollmentId);
}
