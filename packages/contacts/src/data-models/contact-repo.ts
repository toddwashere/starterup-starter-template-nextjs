import { prisma } from "@workspace/database";
import type { Prisma } from "@workspace/database";
import { createId } from "@workspace/common";
import type { CreateContactInput, UpdateContactInput, ContactListFilters } from "../schemas/contact-schemas";

export async function listContactsForOrg(
  organizationId: string,
  filters: Partial<ContactListFilters> = {},
) {
  const {
    search,
    kind,
    stageId,
    tagIds,
    includeArchived = false,
    page = 1,
    pageSize = 20,
  } = filters;

  const where: Prisma.ContactWhereInput = {
    organizationId,
    ...(kind ? { kind } : {}),
    ...(stageId ? { stageId } : {}),
    // OR semantics: contact matches if it has ANY of the listed tags.
    // Segment filters use AND semantics instead — see segment-service.ts.
    ...(tagIds?.length ? { tags: { some: { tagId: { in: tagIds } } } } : {}),
    ...(!includeArchived ? { archivedAt: null } : {}),
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: "insensitive" as const } },
            { primaryEmail: { contains: search, mode: "insensitive" as const } },
            { companyName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  return prisma.contact.findMany({
    where,
    include: {
      stage: true,
      tags: { include: { tag: true } },
    },
    orderBy: { displayName: "asc" },
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
}

export async function getContactById(contactId: string, organizationId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    include: {
      stage: true,
      tags: { include: { tag: true } },
      parent: { select: { id: true, displayName: true, kind: true } },
      children: {
        where: { archivedAt: null },
        select: { id: true, displayName: true, kind: true },
        take: 20,
      },
    },
  });
}

export async function createContact(
  organizationId: string,
  data: CreateContactInput,
) {
  return prisma.contact.create({
    data: {
      id: createId("contact"),
      organizationId,
      ...data,
    },
    include: { stage: true, tags: { include: { tag: true } } },
  });
}

export async function updateContact(
  contactId: string,
  organizationId: string,
  data: UpdateContactInput,
) {
  return prisma.contact.update({
    where: { id: contactId, organizationId },
    data,
    include: { stage: true, tags: { include: { tag: true } } },
  });
}

export async function archiveContact(contactId: string, organizationId: string) {
  return prisma.contact.update({
    where: { id: contactId, organizationId },
    data: { archivedAt: new Date() },
  });
}

export async function unarchiveContact(contactId: string, organizationId: string) {
  return prisma.contact.update({
    where: { id: contactId, organizationId },
    data: { archivedAt: null },
  });
}

export async function countContactsForOrg(organizationId: string): Promise<number> {
  return prisma.contact.count({
    where: { organizationId, archivedAt: null },
  });
}
