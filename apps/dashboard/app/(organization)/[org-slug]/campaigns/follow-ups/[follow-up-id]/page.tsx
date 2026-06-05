import type { Metadata } from "next";
import { FollowUpDetailPageContent } from "@/features/campaigns/follow-up/ui/follow-up-detail-page-content";

export const metadata: Metadata = { title: "Follow-up" };

export default async function FollowUpDetailPage({
  params,
}: {
  params: Promise<{ "org-slug": string; "follow-up-id": string }>;
}) {
  const { "org-slug": orgSlug, "follow-up-id": followUpId } = await params;
  return <FollowUpDetailPageContent orgSlug={orgSlug} followUpId={followUpId} />;
}
