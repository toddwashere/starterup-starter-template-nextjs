"use server";
import { headers } from "next/headers";
import { getOrgPermissionContext } from "@workspace/auth/org-permission-context";
import {
  getMemberManagementContext,
  type MemberManagementContext,
} from "@workspace/auth/member-role-management";

export async function getOrgUpdateContextAction(
  organizationId: string,
): Promise<{ canUpdate: boolean }> {
  const result = await getOrgPermissionContext(organizationId, {
    organization: ["update"],
  });
  return { canUpdate: result.allowed };
}

export async function getApiKeyManageContextAction(
  organizationId: string,
): Promise<{ canRead: boolean; canCreate: boolean }> {
  const [read, create] = await Promise.all([
    getOrgPermissionContext(organizationId, { apiKey: ["read"] }),
    getOrgPermissionContext(organizationId, { apiKey: ["create"] }),
  ]);
  return { canRead: read.allowed, canCreate: create.allowed };
}

/**
 * Per-member management context for the org members UI: whether the actor
 * can manage members at all, the actor's own roles, and — for each
 * requested member ID — whether the actor may manage that target's roles
 * (with a safe reason when not) and whether the actor may transfer
 * ownership to that target. Replaces the boolean-only
 * `getMemberManageContextAction`.
 */
export async function getMemberManagementContextAction(
  organizationId: string,
  memberIds: string[],
): Promise<MemberManagementContext> {
  return getMemberManagementContext(await headers(), organizationId, memberIds);
}
