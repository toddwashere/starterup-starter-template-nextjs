import type { Metadata } from "next";
import { CampaignStepPageContent } from "@/features/campaigns/campaign/ui/campaign-step-page-content";

export const metadata: Metadata = { title: "Campaign step" };

export default async function CampaignStepPage({
  params,
}: {
  params: Promise<{
    "org-slug": string;
    "campaign-id": string;
    "step-id": string;
  }>;
}) {
  const {
    "org-slug": orgSlug,
    "campaign-id": campaignId,
    "step-id": stepId,
  } = await params;
  return (
    <CampaignStepPageContent
      orgSlug={orgSlug}
      campaignId={campaignId}
      stepId={stepId}
    />
  );
}
