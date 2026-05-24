import type { ContactListFilters } from "@workspace/contacts/schemas/contact-schemas";
import type {
  ContactSegmentFilterV1,
  CreateContactSegmentInput,
} from "@workspace/contacts/schemas/segment-schemas";
import { CURRENT_FILTER_VERSION } from "@workspace/contacts/schemas/segment-schemas";

export function contactListFiltersToSegmentFilters(
  filters: Partial<ContactListFilters>,
): ContactSegmentFilterV1 {
  return {
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.stageId ? { stageId: filters.stageId } : {}),
    ...(filters.tagIds?.length ? { tagIds: filters.tagIds } : {}),
    ...(filters.includeArchived ? { includeArchived: true } : {}),
  };
}

export function buildCreateSegmentInput(
  name: string,
  filters: Partial<ContactListFilters>,
): CreateContactSegmentInput {
  return {
    name: name.trim(),
    filters: contactListFiltersToSegmentFilters(filters),
    filterVersion: CURRENT_FILTER_VERSION,
    sortKey: "displayName",
    sortDirection: "asc",
  };
}
