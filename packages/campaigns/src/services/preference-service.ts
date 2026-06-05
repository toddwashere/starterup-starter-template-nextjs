import { prisma } from "@workspace/database";
import { createContactInteraction } from "@workspace/contacts";
import {
  setContactEmailPreference,
  optOutOfSequence,
} from "../data-models/email-preference-repo";
import { exitActiveEnrollmentsForContact } from "../data-models/email-enrollment-repo";
import { getEmailSequenceById } from "../data-models/email-sequence-repo";
import { verifyMarketingToken } from "../marketing-token";

export async function unsubscribeAll(contactId: string, organizationId: string) {
  await setContactEmailPreference(contactId, organizationId, "unsubscribed");
  await exitActiveEnrollmentsForContact(contactId, organizationId, "unsubscribed_all");

  await createContactInteraction(contactId, organizationId, contactId, {
    contactId,
    type: "email",
    body: "Unsubscribed from all marketing email",
  });
}

export async function unsubscribeFromSequence(
  contactId: string,
  sequenceId: string,
  organizationId: string,
) {
  await optOutOfSequence(contactId, sequenceId);
  await exitActiveEnrollmentsForContact(
    contactId,
    organizationId,
    "unsubscribed_sequence",
    sequenceId,
  );

  await createContactInteraction(contactId, organizationId, contactId, {
    contactId,
    type: "email",
    body: `Unsubscribed from sequence ${sequenceId}`,
  });
}


export async function getPreferencePageContext(token: string) {
  const payload = verifyMarketingToken(token);
  const org = await prisma.organization.findFirst({
    where: { id: payload.organizationId },
    select: { name: true },
  });
  const sequence = payload.sequenceId
    ? await getEmailSequenceById(payload.sequenceId, payload.organizationId)
    : null;

  return {
    organizationName: org?.name ?? "Our team",
    sequenceName: sequence?.name ?? null,
    showSequenceUnsubscribe: Boolean(payload.sequenceId),
    contactId: payload.contactId,
    organizationId: payload.organizationId,
    sequenceId: payload.sequenceId,
  };
}

export async function unsubscribeFromToken(token: string) {
  const payload = verifyMarketingToken(token);

  if (payload.scope === "all") {
    await unsubscribeAll(payload.contactId, payload.organizationId);
    return;
  }

  if (payload.scope === "sequence" && payload.sequenceId) {
    await unsubscribeFromSequence(
      payload.contactId,
      payload.sequenceId,
      payload.organizationId,
    );
    return;
  }

  throw new Error("Invalid unsubscribe token scope");
}
