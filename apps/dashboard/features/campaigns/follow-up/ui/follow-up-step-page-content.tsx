import { getPathForOrgFollowUp, getPathForOrgFollowUps } from "@workspace/routes";
import {
  deleteFollowUpStepAction,
  getFollowUpStepAction,
  updateFollowUpStepAction,
} from "../data/follow-up-actions";
import { SequenceStepEditPageContent } from "../../common/ui/sequence-step-edit-page-content";

export function FollowUpStepPageContent({
  orgSlug,
  followUpId,
  stepId,
}: {
  orgSlug: string;
  followUpId: string;
  stepId: string;
}) {
  return (
    <SequenceStepEditPageContent
      listLabel="Follow-ups"
      listHref={getPathForOrgFollowUps(orgSlug)}
      sequenceHref={getPathForOrgFollowUp(orgSlug, followUpId)}
      sequenceId={followUpId}
      stepId={stepId}
      notFoundMessage="This follow-up step may have been removed."
      loadStepAction={getFollowUpStepAction}
      updateStepAction={updateFollowUpStepAction}
      deleteStepAction={deleteFollowUpStepAction}
    />
  );
}
