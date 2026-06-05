import type { Metadata } from "next";
import { FollowUpStepPageContent } from "@/features/campaigns/follow-up/ui/follow-up-step-page-content";

export const metadata: Metadata = { title: "Follow-up step" };

export default async function FollowUpStepPage({
  params,
}: {
  params: Promise<{
    "org-slug": string;
    "follow-up-id": string;
    "step-id": string;
  }>;
}) {
  const {
    "org-slug": orgSlug,
    "follow-up-id": followUpId,
    "step-id": stepId,
  } = await params;
  return (
    <FollowUpStepPageContent
      orgSlug={orgSlug}
      followUpId={followUpId}
      stepId={stepId}
    />
  );
}
