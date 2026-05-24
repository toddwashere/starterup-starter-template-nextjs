import { prisma } from "@workspace/database";
import type { Prisma } from "@workspace/database";
import { getContactSegmentById, updateContactSegment } from "../data-models/contact-segment-repo";
import { listContactsByIds } from "../data-models/contact-repo";
import {
  ContactSegmentFilterSchemaV1,
  ContactSegmentFilterSchemaV2,
  type ContactSegmentFilterV2,
} from "../schemas/segment-schemas";

export function validateSegmentFilters(
  filters: unknown,
  filterVersion: number,
): ContactSegmentFilterV2 {
  if (filterVersion === 1) {
    return ContactSegmentFilterSchemaV1.parse(filters);
  }
  if (filterVersion === 2) {
    return ContactSegmentFilterSchemaV2.parse(filters);
  }
  throw new Error(`Unsupported filter version: ${filterVersion}`);
}

export function buildContactWhereFromSegment(
  organizationId: string,
  filters: ContactSegmentFilterV2,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { organizationId };

  if (!filters.includeArchived) {
    where.archivedAt = null;
  }
  if (filters.kind) {
    where.kind = filters.kind;
  }
  if (filters.stageId) {
    where.stageId = filters.stageId;
  }
  if (filters.search) {
    where.OR = [
      { displayName: { contains: filters.search, mode: "insensitive" } },
      { primaryEmail: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  // AND semantics: contact must have ALL listed tags.
  // Note: listContactsForOrg uses OR (any tag) — this deliberate difference makes
  // segment filters more precise than the general list filter.
  if (filters.tagIds && filters.tagIds.length > 0) {
    where.AND = filters.tagIds.map((tagId) => ({
      tags: { some: { tagId } },
    }));
  }

  return where;
}

// A contact belongs to a segment if it matches the dynamic filters OR is one of
// the explicit contactIds. v1 segments (no contactIds) behave exactly as before.
export function buildSegmentMembershipWhere(
  organizationId: string,
  filters: ContactSegmentFilterV2,
): Prisma.ContactWhereInput {
  const dynamicWhere = buildContactWhereFromSegment(organizationId, filters);
  const contactIds = filters.contactIds ?? [];
  if (contactIds.length === 0) {
    return dynamicWhere;
  }
  return {
    organizationId,
    OR: [dynamicWhere, { id: { in: contactIds } }],
  };
}

export async function countContactsForSegment(
  organizationId: string,
  segmentId: string,
): Promise<number> {
  const segment = await getContactSegmentById(segmentId, organizationId);
  if (!segment) {
    throw new Error("Segment not found in this organization");
  }

  const filters = validateSegmentFilters(segment.filters, segment.filterVersion);

  return prisma.contact.count({
    where: buildSegmentMembershipWhere(organizationId, filters),
  });
}

export async function listContactsForSegment(
  organizationId: string,
  segmentId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const segment = await getContactSegmentById(segmentId, organizationId);
  if (!segment) {
    throw new Error("Segment not found in this organization");
  }

  const filters = validateSegmentFilters(segment.filters, segment.filterVersion);
  const { page = 1, pageSize = 20 } = options;

  return prisma.contact.findMany({
    where: buildSegmentMembershipWhere(organizationId, filters),
    include: {
      stage: true,
      tags: { include: { tag: true } },
    },
    orderBy: { [segment.sortKey]: segment.sortDirection },
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
}

export async function addContactsToSegment(
  organizationId: string,
  segmentId: string,
  contactIds: string[],
): Promise<{ addedCount: number; totalExplicitIds: number }> {
  if (contactIds.length === 0) {
    throw new Error("No contacts provided");
  }

  const segment = await getContactSegmentById(segmentId, organizationId);
  if (!segment) {
    throw new Error("Segment not found in this organization");
  }

  // Fail loudly if any id is not a live contact in this org (no silent partial add).
  const found = await listContactsByIds(organizationId, contactIds);
  if (found.length !== contactIds.length) {
    throw new Error("One or more contacts were not found in this organization");
  }

  const filters = validateSegmentFilters(segment.filters, segment.filterVersion);
  const existing = filters.contactIds ?? [];
  const merged = Array.from(new Set([...existing, ...contactIds]));

  // updateContactSegment bumps filterVersion to CURRENT_FILTER_VERSION (2) when filters change.
  await updateContactSegment(segmentId, organizationId, {
    filters: { ...filters, contactIds: merged },
  });

  return {
    addedCount: merged.length - existing.length,
    totalExplicitIds: merged.length,
  };
}
