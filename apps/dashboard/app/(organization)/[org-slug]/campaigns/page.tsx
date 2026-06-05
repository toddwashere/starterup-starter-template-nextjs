import type { Metadata } from "next";
import { CampaignsPageContent } from "@/features/campaigns/campaign/ui/campaigns-page-content";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ "org-slug": string }>;
}) {
  const { "org-slug": orgSlug } = await params;
  return <CampaignsPageContent orgSlug={orgSlug} />;
}
