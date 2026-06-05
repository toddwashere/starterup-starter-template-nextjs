import { prisma } from "@workspace/database";
import { sendMarketingEmail } from "@workspace/email/marketing/send-marketing-email";
import { marketingTemplateRegistry } from "@workspace/email/marketing/marketing-template-registry";
import { createContactInteraction } from "@workspace/contacts";
import { enqueue } from "@workspace/worker-queue";
import { keys } from "../../keys";
import { signMarketingToken } from "../marketing-token";
import {
  getEmailStepSendById,
  markEmailStepSendSent,
  markEmailStepSendSkipped,
  createEmailStepSend,
  findEmailStepSendByIdempotencyKey,
} from "../data-models/email-step-send-repo";
import {
  updateEmailEnrollment,
  getEmailEnrollmentById,
} from "../data-models/email-enrollment-repo";
import { isContactSubscribed, isSequenceOptedOut } from "../data-models/email-preference-repo";
import { insertEmailLinkClick } from "../data-models/email-link-click-repo";

function getPublicBaseUrl() {
  return keys().NEXT_PUBLIC_WWW_URL.replace(/\/$/, "");
}

function buildPreferenceUrl(token: string) {
  return `${getPublicBaseUrl()}/email/preferences?token=${encodeURIComponent(token)}`;
}

function buildOneClickUnsubscribeUrl(token: string) {
  return `${getPublicBaseUrl()}/email/preferences/one-click?token=${encodeURIComponent(token)}`;
}

function buildClickRedirectUrl(
  payload: Parameters<typeof signMarketingToken>[0],
  destinationUrl: string,
) {
  const token = signMarketingToken({
    ...payload,
    scope: "click",
    destinationUrl,
  });
  return `${getPublicBaseUrl()}/email/go/${encodeURIComponent(token)}`;
}

async function getOrganizationName(organizationId: string) {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { name: true },
  });
  return org?.name ?? "Our team";
}

async function getContactForEnrollment(enrollment: {
  contactId: string;
  organizationId: string;
}) {
  return prisma.contact.findFirst({
    where: {
      id: enrollment.contactId,
      organizationId: enrollment.organizationId,
    },
  });
}

function shouldSkipSend(context: {
  contactEmail: string | null | undefined;
  subscribed: boolean;
  sequenceOptedOut: boolean;
  sequenceStatus: string;
  campaignRunStatus?: string | null;
  enrollmentStatus: string;
}): { skip: boolean; exitReason?: "missing_email" | "unsubscribed_all" | "unsubscribed_sequence" } {
  if (!context.contactEmail) {
    return { skip: true, exitReason: "missing_email" };
  }
  if (!context.subscribed) {
    return { skip: true, exitReason: "unsubscribed_all" };
  }
  if (context.sequenceOptedOut) {
    return { skip: true, exitReason: "unsubscribed_sequence" };
  }
  if (context.sequenceStatus === "paused" || context.sequenceStatus === "archived") {
    return { skip: true };
  }
  if (
    context.campaignRunStatus === "paused" ||
    context.campaignRunStatus === "cancelled"
  ) {
    return { skip: true };
  }
  if (context.enrollmentStatus !== "active") {
    return { skip: true };
  }
  return { skip: false };
}

export async function executeStepSend(stepSendId: string): Promise<void> {
  const stepSend = await getEmailStepSendById(stepSendId);
  if (!stepSend) {
    throw new Error("Step send not found");
  }

  if (stepSend.status !== "pending") {
    return;
  }

  const enrollment = stepSend.enrollment;
  const sequence = enrollment.sequence;
  const step = stepSend.step;
  const contact = await getContactForEnrollment(enrollment);

  const subscribed = contact
    ? await isContactSubscribed(contact.id, enrollment.organizationId)
    : false;
  const sequenceOptedOut = contact
    ? await isSequenceOptedOut(contact.id, sequence.id)
    : false;

  const skipResult = shouldSkipSend({
    contactEmail: contact?.primaryEmail,
    subscribed,
    sequenceOptedOut,
    sequenceStatus: sequence.status,
    campaignRunStatus: enrollment.campaignRun?.status,
    enrollmentStatus: enrollment.status,
  });

  if (skipResult.skip) {
    await markEmailStepSendSkipped(stepSendId, skipResult.exitReason ?? "skipped");
    if (skipResult.exitReason) {
      await updateEmailEnrollment(enrollment.id, enrollment.organizationId, {
        status: "exited",
        exitReason: skipResult.exitReason,
        completedAt: new Date(),
        nextSendAt: null,
      });
    }
    return;
  }

  const organizationName = await getOrganizationName(enrollment.organizationId);
  const tokenBase = {
    contactId: contact!.id,
    organizationId: enrollment.organizationId,
    scope: "click" as const,
    sequenceId: sequence.id,
    stepSendId: stepSend.id,
    utmMedium: sequence.kind === "follow_up" ? "follow_up" : "campaign",
    utmCampaign: sequence.slug,
    utmContent: `step-${step.sortOrder + 1}`,
  };

  const preferenceToken = signMarketingToken({
    contactId: contact!.id,
    organizationId: enrollment.organizationId,
    scope: "sequence",
    sequenceId: sequence.id,
  });
  const allToken = signMarketingToken({
    contactId: contact!.id,
    organizationId: enrollment.organizationId,
    scope: "all",
  });

  const registryEntry =
    marketingTemplateRegistry[step.templateKey as keyof typeof marketingTemplateRegistry];
  if (!registryEntry) {
    throw new Error(`Unknown template key: ${step.templateKey}`);
  }

  const parsedProps = registryEntry.propsSchema.parse(step.templateProps ?? {});

  const { providerMessageId } = await sendMarketingEmail({
    recipient: contact!.primaryEmail!,
    subjectTemplate: step.subjectTemplate,
    templateKey: step.templateKey as keyof typeof marketingTemplateRegistry,
    templateProps: parsedProps as Record<string, unknown>,
    organizationName,
    mergeData: {
      displayName: contact!.displayName,
      firstName: contact!.firstName,
      lastName: contact!.lastName,
      companyName: contact!.companyName,
      primaryEmail: contact!.primaryEmail,
      organizationName,
    },
    unsubscribeUrl: buildPreferenceUrl(preferenceToken),
    oneClickUnsubscribeUrl: buildOneClickUnsubscribeUrl(allToken),
    buildClickRedirectUrl: (destinationUrl) =>
      buildClickRedirectUrl(tokenBase, destinationUrl),
    metadata: {
      stepSendId: stepSend.id,
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      organizationId: enrollment.organizationId,
    },
  });

  await markEmailStepSendSent(stepSendId, providerMessageId ?? "");

  await createContactInteraction(
    contact!.id,
    enrollment.organizationId,
    enrollment.enrolledById,
    {
      contactId: contact!.id,
      type: "email",
      body: `Sent "${step.subjectTemplate}" (${sequence.name})`,
    },
  );

  const nextIndex = enrollment.currentStepIndex + 1;
  if (nextIndex >= sequence.steps.length) {
    await updateEmailEnrollment(enrollment.id, enrollment.organizationId, {
      status: "completed",
      currentStepIndex: nextIndex,
      completedAt: new Date(),
      nextSendAt: null,
    });
    return;
  }

  await updateEmailEnrollment(enrollment.id, enrollment.organizationId, {
    currentStepIndex: nextIndex,
  });

  await enqueue("campaign.schedule-next-step", { enrollmentId: enrollment.id });
}

export async function scheduleNextStep(enrollmentId: string): Promise<void> {
  const enrollment = await prisma.emailEnrollment.findFirst({
    where: { id: enrollmentId },
    include: {
      sequence: { include: { steps: { orderBy: { sortOrder: "asc" } } } },
    },
  });

  if (!enrollment || enrollment.status !== "active") {
    return;
  }

  const step = enrollment.sequence.steps[enrollment.currentStepIndex];
  if (!step) {
    return;
  }

  const idempotencyKey = `${enrollment.id}:${step.id}`;
  const existing = await findEmailStepSendByIdempotencyKey(idempotencyKey);
  if (existing) {
    return;
  }

  const stepSend = await createEmailStepSend({
    enrollmentId: enrollment.id,
    stepId: step.id,
    idempotencyKey,
  });

  const nextSendAt = new Date(Date.now() + step.delayMinutes * 60_000);
  await updateEmailEnrollment(enrollment.id, enrollment.organizationId, {
    nextSendAt,
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

export async function recordLinkClick(payload: {
  stepSendId: string;
  destinationUrl: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}) {
  return insertEmailLinkClick({
    stepSendId: payload.stepSendId,
    destinationUrl: payload.destinationUrl,
    utmSource: payload.utmSource ?? "email",
    utmMedium: payload.utmMedium ?? "campaign",
    utmCampaign: payload.utmCampaign ?? "",
    utmContent: payload.utmContent ?? "",
  });
}
