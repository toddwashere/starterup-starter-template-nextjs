import type { Metadata } from "next";
import { CampaignDetailPageContent } from "@/features/campaigns/campaign/ui/campaign-detail-page-content";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ "org-slug": string; "campaign-id": string }>;
}) {
  const { "org-slug": orgSlug, "campaign-id": campaignId } = await params;
  return <CampaignDetailPageContent orgSlug={orgSlug} campaignId={campaignId} />;
}
