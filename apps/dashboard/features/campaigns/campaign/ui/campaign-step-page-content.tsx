import {
  getPathForOrgCampaign,
  getPathForOrgCampaigns,
} from "@workspace/routes";
import {
  deleteCampaignStepAction,
  getCampaignStepAction,
  updateCampaignStepAction,
} from "../data/campaign-actions";
import { SequenceStepEditPageContent } from "../../common/ui/sequence-step-edit-page-content";

export function CampaignStepPageContent({
  orgSlug,
  campaignId,
  stepId,
}: {
  orgSlug: string;
  campaignId: string;
  stepId: string;
}) {
  return (
    <SequenceStepEditPageContent
      listLabel="Campaigns"
      listHref={getPathForOrgCampaigns(orgSlug)}
      sequenceHref={getPathForOrgCampaign(orgSlug, campaignId)}
      sequenceId={campaignId}
      stepId={stepId}
      notFoundMessage="This campaign step may have been removed."
      loadStepAction={getCampaignStepAction}
      updateStepAction={updateCampaignStepAction}
      deleteStepAction={deleteCampaignStepAction}
    />
  );
}
