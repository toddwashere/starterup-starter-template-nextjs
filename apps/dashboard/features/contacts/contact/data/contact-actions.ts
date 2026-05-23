"use server";

import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import {
  listContactsForOrg,
  getContactById,
  createContactWithValidation,
  updateContactWithValidation,
  archiveContact,
  countContactsForOrg,
} from "@workspace/contacts";
import type { ContactListFilters, CreateContactInput, UpdateContactInput } from "@workspace/contacts";
import { requireOrgEntitlement, BillingEntitlementError } from "@workspace/billing";
import type { ActionResult } from "@/common/data/action-result";

export async function listContactsAction(
  filters: Partial<ContactListFilters> = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listContactsForOrg>>>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["read"],
    });
    const data = await listContactsForOrg(activeOrganizationId, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to load contacts" };
  }
}

export async function getContactAction(
  contactId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getContactById>>>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["read"],
    });
    const data = await getContactById(contactId, activeOrganizationId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to load contact" };
  }
}

export async function createContactAction(
  data: CreateContactInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["create"],
    });
    const currentCount = await countContactsForOrg(activeOrganizationId);
    await requireOrgEntitlement(activeOrganizationId, "contacts", currentCount + 1);
    const contact = await createContactWithValidation(activeOrganizationId, data);
    return { success: true, data: { id: contact.id } };
  } catch (err) {
    if (err instanceof BillingEntitlementError) {
      return {
        success: false,
        error: "You've reached your plan's contact limit. Upgrade your plan to add more contacts.",
      };
    }
    return { success: false, error: err instanceof Error ? err.message : "Failed to create contact" };
  }
}

export async function updateContactAction(
  contactId: string,
  data: UpdateContactInput,
): Promise<ActionResult> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["update"],
    });
    await updateContactWithValidation(contactId, activeOrganizationId, data);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update contact" };
  }
}

export async function archiveContactAction(contactId: string): Promise<ActionResult> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["delete"],
    });
    await archiveContact(contactId, activeOrganizationId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to archive contact" };
  }
}
