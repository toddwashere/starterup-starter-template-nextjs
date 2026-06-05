import { prisma } from "@workspace/database";
import { getContactSegmentById } from "@workspace/contacts";
import {
  buildSegmentMembershipWhere,
  validateSegmentFilters,
} from "@workspace/contacts";
import { enqueue } from "@workspace/worker-queue";
import { getEmailCampaignRunById, updateEmailCampaignRun } from "../data-models/email-campaign-run-repo";
import {
  createEmailEnrollments,
  getActiveEnrollmentForContactAndSequence,
} from "../data-models/email-enrollment-repo";
import {
  createEmailStepSend,
  findEmailStepSendByIdempotencyKey,
} from "../data-models/email-step-send-repo";
import { isContactSubscribed, isSequenceOptedOut } from "../data-models/email-preference-repo";
import { getEmailSequenceById } from "../data-models/email-sequence-repo";

async function listAllContactsForSegment(organizationId: string, segmentId: string) {
  const segment = await getContactSegmentById(segmentId, organizationId);
  if (!segment) {
    throw new Error("Segment not found in this organization");
  }

  const filters = validateSegmentFilters(segment.filters, segment.filterVersion);
  return prisma.contact.findMany({
    where: buildSegmentMembershipWhere(organizationId, filters),
    select: {
      id: true,
      primaryEmail: true,
    },
  });
}

async function isEligibleForEnrollment(
  organizationId: string,
  contactId: string,
  sequenceId: string,
  primaryEmail: string | null,
): Promise<boolean> {
  if (!primaryEmail) {
    return false;
  }
  if (!(await isContactSubscribed(contactId, organizationId))) {
    return false;
  }
  if (await isSequenceOptedOut(contactId, sequenceId)) {
    return false;
  }
  const active = await getActiveEnrollmentForContactAndSequence(
    contactId,
    sequenceId,
    organizationId,
  );
  return active === null;
}

async function enqueueFirstStepForEnrollment(
  enrollmentId: string,
  sequenceId: string,
  organizationId: string,
  currentStepIndex: number,
) {
  const sequence = await getEmailSequenceById(sequenceId, organizationId);
  if (!sequence || sequence.steps.length === 0) {
    return;
  }

  const step = sequence.steps[currentStepIndex];
  if (!step) {
    return;
  }

  const idempotencyKey = `${enrollmentId}:${step.id}`;
  const existing = await findEmailStepSendByIdempotencyKey(idempotencyKey);
  if (existing) {
    return;
  }

  const stepSend = await createEmailStepSend({
    enrollmentId,
    stepId: step.id,
    idempotencyKey,
  });

  await enqueue(
    "campaign.send-step",
    { stepSendId: stepSend.id },
    {
      idempotencyKey,
      delayMs: step.delayMinutes * 60_000,
    },
  );
}

export async function enrollSegmentSnapshot(
  organizationId: string,
  campaignRunId: string,
  sequenceId: string,
  segmentId: string,
  enrolledById: string,
): Promise<{ enrolledCount: number }> {
  const run = await getEmailCampaignRunById(campaignRunId, organizationId);
  if (!run) {
    throw new Error("Campaign run not found in this organization");
  }

  const contacts = await listAllContactsForSegment(organizationId, segmentId);
  const eligible: Array<{ contactId: string }> = [];

  for (const contact of contacts) {
    if (
      await isEligibleForEnrollment(
        organizationId,
        contact.id,
        sequenceId,
        contact.primaryEmail,
      )
    ) {
      eligible.push({ contactId: contact.id });
    }
  }

  if (eligible.length === 0) {
    await updateEmailCampaignRun(campaignRunId, organizationId, { enrolledCount: 0 });
    return { enrolledCount: 0 };
  }

  const enrollments = await createEmailEnrollments(
    organizationId,
    eligible.map((item) => ({
      sequenceId,
      contactId: item.contactId,
      campaignRunId,
      enrolledById,
    })),
  );

  await updateEmailCampaignRun(campaignRunId, organizationId, {
    enrolledCount: enrollments.length,
  });

  for (const enrollment of enrollments) {
    await enqueueFirstStepForEnrollment(
      enrollment.id,
      sequenceId,
      organizationId,
      enrollment.currentStepIndex,
    );
  }

  return { enrolledCount: enrollments.length };
}

export async function enrollContactsInFollowUp(
  organizationId: string,
  sequenceId: string,
  contactIds: string[],
  enrolledById: string,
): Promise<{ enrolledCount: number }> {
  if (contactIds.length === 0) {
    return { enrolledCount: 0 };
  }

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      id: { in: contactIds },
      archivedAt: null,
    },
    select: { id: true, primaryEmail: true },
  });

  const eligible: Array<{ contactId: string }> = [];
  for (const contact of contacts) {
    if (
      await isEligibleForEnrollment(
        organizationId,
        contact.id,
        sequenceId,
        contact.primaryEmail,
      )
    ) {
      eligible.push({ contactId: contact.id });
    }
  }

  if (eligible.length === 0) {
    return { enrolledCount: 0 };
  }

  const enrollments = await createEmailEnrollments(
    organizationId,
    eligible.map((item) => ({
      sequenceId,
      contactId: item.contactId,
      enrolledById,
    })),
  );

  for (const enrollment of enrollments) {
    await enqueueFirstStepForEnrollment(
      enrollment.id,
      sequenceId,
      organizationId,
      enrollment.currentStepIndex,
    );
  }

  return { enrolledCount: enrollments.length };
}
