import { headers } from "next/headers";
import { auth } from "./auth";

/**
 * Non-throwing org permission check for UI gating. Returns { allowed } so
 * components can show a read-only view instead of erroring. Mirrors
 * getBillingContextForOrg in the dashboard.
 */
export async function getOrgPermissionContext(
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<{ allowed: boolean }> {
  try {
    const result = await auth.api.hasPermission({
      headers: await headers(),
      body: { organizationId, permissions },
    });
    return { allowed: result?.success === true };
  } catch {
    return { allowed: false };
  }
}
