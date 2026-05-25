"use server";
import { getOrgPermissionContext } from "@workspace/auth/org-permission-context";

export async function getApiKeyManageContextAction(
  organizationId: string,
): Promise<{ canRead: boolean; canCreate: boolean }> {
  const [read, create] = await Promise.all([
    getOrgPermissionContext(organizationId, { apiKey: ["read"] }),
    getOrgPermissionContext(organizationId, { apiKey: ["create"] }),
  ]);
  return { canRead: read.allowed, canCreate: create.allowed };
}
