"use server";

import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import {
  listContactSegmentsForOrg,
  createContactSegment,
  deleteContactSegment,
  listContactsForSegment,
  addContactsToSegment,
  countContactsForSegment,
} from "@workspace/contacts";
import type { CreateContactSegmentInput } from "@workspace/contacts";
import type { ActionResult } from "@/common/data/action-result";

export async function listContactSegmentsAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof listContactSegmentsForOrg>>>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["read"],
    });
    const data = await listContactSegmentsForOrg(activeOrganizationId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to load segments" };
  }
}

export async function createContactSegmentAction(
  data: CreateContactSegmentInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contactSettings: ["create"],
    });
    const segment = await createContactSegment(
      activeOrganizationId,
      session.user.id,
      data,
    );
    return { success: true, data: { id: segment.id } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create segment" };
  }
}

export async function deleteContactSegmentAction(segmentId: string): Promise<ActionResult> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contactSettings: ["delete"],
    });
    await deleteContactSegment(segmentId, activeOrganizationId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete segment" };
  }
}

export async function listContactsForSegmentAction(
  segmentId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<
  ActionResult<{
    rows: Awaited<ReturnType<typeof listContactsForSegment>>;
    totalCount: number;
  }>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contact: ["read"],
    });
    const [rows, totalCount] = await Promise.all([
      listContactsForSegment(activeOrganizationId, segmentId, options),
      countContactsForSegment(activeOrganizationId, segmentId),
    ]);
    return { success: true, data: { rows, totalCount } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load segment contacts",
    };
  }
}

const MAX_SEGMENT_ADD_IDS = 1000;

export async function addContactsToSegmentAction(
  segmentId: string,
  contactIds: string[],
): Promise<ActionResult<{ addedCount: number; totalExplicitIds: number }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      contactSettings: ["update"],
    });

    if (contactIds.length === 0) {
      return { success: false, error: "No contacts selected" };
    }
    if (contactIds.length > MAX_SEGMENT_ADD_IDS) {
      return {
        success: false,
        error: `Cannot add more than ${MAX_SEGMENT_ADD_IDS} contacts at once`,
      };
    }

    const data = await addContactsToSegment(activeOrganizationId, segmentId, contactIds);
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add contacts to segment",
    };
  }
}
