import {
  findEmailStepSendByProviderMessageId,
  markEmailStepSendDelivered,
  markEmailStepSendFailed,
} from "../data-models/email-step-send-repo";
import { appendEmailDeliveryEvent } from "../data-models/email-delivery-event-repo";
import { setContactEmailPreference } from "../data-models/email-preference-repo";
import { exitActiveEnrollmentsForContact } from "../data-models/email-enrollment-repo";
import { createContactInteraction } from "@workspace/contacts";
import { prisma } from "@workspace/database";

export type NormalizedDeliveryEvent = {
  type: "delivered" | "bounced" | "complained";
  providerMessageId: string;
  occurredAt: string;
  recipient?: string;
  bounceClass?: "hard" | "soft";
  rawType?: string;
};

async function suppressContactAndExitEnrollments(
  contactId: string,
  organizationId: string,
  exitReason: "bounced" | "complained",
  interactionBody: string,
) {
  await setContactEmailPreference(contactId, organizationId, "unsubscribed");
  await exitActiveEnrollmentsForContact(contactId, organizationId, exitReason);
  await createContactInteraction(contactId, organizationId, contactId, {
    contactId,
    type: "email",
    body: interactionBody,
  });
}

export async function applyDeliveryEvent(
  provider: string,
  event: NormalizedDeliveryEvent,
): Promise<void> {
  const stepSend = await findEmailStepSendByProviderMessageId(event.providerMessageId);

  await appendEmailDeliveryEvent({
    stepSendId: stepSend?.id,
    provider,
    providerMessageId: event.providerMessageId,
    type: event.type,
    bounceClass: event.bounceClass,
    occurredAt: new Date(event.occurredAt),
    rawType: event.rawType,
  });

  if (!stepSend?.enrollment) {
    return;
  }

  const { contactId, organizationId } = stepSend.enrollment;

  if (event.type === "delivered") {
    await markEmailStepSendDelivered(stepSend.id);
    return;
  }

  if (event.type === "bounced" && event.bounceClass === "soft") {
    await markEmailStepSendFailed(stepSend.id, "soft bounce");
    await createContactInteraction(contactId, organizationId, contactId, {
      contactId,
      type: "email",
      body: "Email soft bounced",
    });
    return;
  }

  if (event.type === "bounced" && event.bounceClass === "hard") {
    await markEmailStepSendFailed(stepSend.id, "hard bounce");
    await suppressContactAndExitEnrollments(
      contactId,
      organizationId,
      "bounced",
      "Email hard bounced — contact suppressed",
    );
    return;
  }

  if (event.type === "complained") {
    await markEmailStepSendFailed(stepSend.id, "complaint");
    await suppressContactAndExitEnrollments(
      contactId,
      organizationId,
      "complained",
      "Email complaint — contact suppressed",
    );
  }
}

export async function processDeliveryEvents(
  provider: string,
  events: NormalizedDeliveryEvent[],
): Promise<void> {
  for (const event of events) {
    await applyDeliveryEvent(provider, event);
  }
}

export async function resolveContactFromRecipient(recipient: string, organizationId: string) {
  return prisma.contact.findFirst({
    where: { organizationId, primaryEmail: recipient },
    select: { id: true },
  });
}
