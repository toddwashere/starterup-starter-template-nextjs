import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";
import type { EmailPreferenceStatus } from "../schemas/sequence-schemas";

export async function getContactEmailPreference(contactId: string, organizationId: string) {
  return prisma.contactEmailPreference.findUnique({
    where: {
      contactId_organizationId: { contactId, organizationId },
    },
  });
}

export async function isContactSubscribed(contactId: string, organizationId: string) {
  const pref = await getContactEmailPreference(contactId, organizationId);
  return !pref || pref.status === "subscribed";
}

export async function setContactEmailPreference(
  contactId: string,
  organizationId: string,
  status: EmailPreferenceStatus,
) {
  return prisma.contactEmailPreference.upsert({
    where: {
      contactId_organizationId: { contactId, organizationId },
    },
    create: {
      id: createId("epref"),
      contactId,
      organizationId,
      status,
      unsubscribedAt: status === "unsubscribed" ? new Date() : null,
    },
    update: {
      status,
      unsubscribedAt: status === "unsubscribed" ? new Date() : null,
    },
  });
}

export async function isSequenceOptedOut(contactId: string, sequenceId: string) {
  const optOut = await prisma.contactEmailSequenceOptOut.findUnique({
    where: {
      contactId_sequenceId: { contactId, sequenceId },
    },
  });
  return optOut !== null;
}

export async function optOutOfSequence(contactId: string, sequenceId: string) {
  return prisma.contactEmailSequenceOptOut.upsert({
    where: {
      contactId_sequenceId: { contactId, sequenceId },
    },
    create: {
      contactId,
      sequenceId,
    },
    update: {},
  });
}
