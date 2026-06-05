import type { Metadata } from "next";
import { FollowUpsPageContent } from "@/features/campaigns/follow-up/ui/follow-ups-page-content";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({
  params,
}: {
  params: Promise<{ "org-slug": string }>;
}) {
  const { "org-slug": orgSlug } = await params;
  return <FollowUpsPageContent orgSlug={orgSlug} />;
}
