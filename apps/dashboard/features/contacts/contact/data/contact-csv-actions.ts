"use server";

import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import {
  parseContactsCsv,
  exportContactsToCsv,
  createContactWithValidation,
  listContactsForOrg,
  parseTagNamesFromCsv,
  setContactTagsForContact,
  formatContactTagsForCsv,
  listContactsForSegment,
  listContactsByIds,
} from "@workspace/contacts";
import type { ContactListFilters } from "@workspace/contacts";
import type { ActionResult } from "@/common/data/action-result";

export async function previewContactCsvImportAction(
  csvText: string,
): Promise<ActionResult<Awaited<ReturnType<typeof parseContactsCsv>>>> {
  try {
    await requireOrgPermissionWithActiveOrg({
      contact: ["import"],
    });
    const result = parseContactsCsv(csvText);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to parse CSV" };
  }
}

export async function commitContactCsvImportAction(
  csvText: string,
): Promise<ActionResult<{ imported: number; skipped: number }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["import"],
    });
    const { valid } = parseContactsCsv(csvText);
    let imported = 0;
    let skipped = 0;
    for (const row of valid) {
      try {
        const contact = await createContactWithValidation(activeOrganizationId, {
          kind: row.kind,
          displayName: row.displayName,
          firstName: row.firstName,
          lastName: row.lastName,
          companyName: row.companyName,
          primaryEmail: row.primaryEmail,
          primaryPhone: row.primaryPhone,
          website: row.website,
          source: row.source,
        });
        const tagNames = parseTagNamesFromCsv(row.tags);
        if (tagNames.length > 0) {
          await setContactTagsForContact(contact.id, activeOrganizationId, tagNames);
        }
        imported++;
      } catch {
        skipped++;
      }
    }
    return { success: true, data: { imported, skipped } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Import failed" };
  }
}

export async function exportContactsCsvAction(
  options: { segmentId?: string; filters?: Partial<ContactListFilters> } = {},
): Promise<ActionResult<string>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["export"],
    });

    const contacts = options.segmentId
      ? await listContactsForSegment(activeOrganizationId, options.segmentId, {
          pageSize: 5000,
        })
      : await listContactsForOrg(activeOrganizationId, {
          ...options.filters,
          pageSize: 5000,
        });

    const csv = exportContactsToCsv(
      contacts.map((c) => ({
        displayName: c.displayName,
        kind: c.kind as "person" | "company",
        firstName: c.firstName ?? undefined,
        lastName: c.lastName ?? undefined,
        companyName: c.companyName ?? undefined,
        primaryEmail: c.primaryEmail ?? undefined,
        primaryPhone: c.primaryPhone ?? undefined,
        website: c.website ?? undefined,
        source: c.source ?? undefined,
        tags: formatContactTagsForCsv(c.tags),
      })),
    );
    return { success: true, data: csv };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

const MAX_EXPORT_IDS = 1000;

export async function exportContactsByIdsAction(
  contactIds: string[],
): Promise<ActionResult<string>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["export"],
    });

    if (contactIds.length === 0) {
      return { success: false, error: "No contacts selected" };
    }
    if (contactIds.length > MAX_EXPORT_IDS) {
      return {
        success: false,
        error: `Cannot export more than ${MAX_EXPORT_IDS} contacts at once`,
      };
    }

    const contacts = await listContactsByIds(activeOrganizationId, contactIds);
    if (contacts.length !== contactIds.length) {
      return { success: false, error: "Some selected contacts could not be found" };
    }

    const csv = exportContactsToCsv(
      contacts.map((c) => ({
        displayName: c.displayName,
        kind: c.kind as "person" | "company",
        firstName: c.firstName ?? undefined,
        lastName: c.lastName ?? undefined,
        companyName: c.companyName ?? undefined,
        primaryEmail: c.primaryEmail ?? undefined,
        primaryPhone: c.primaryPhone ?? undefined,
        website: c.website ?? undefined,
        source: c.source ?? undefined,
        tags: formatContactTagsForCsv(c.tags),
      })),
    );
    return { success: true, data: csv };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}
