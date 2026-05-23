import { getOrgLimits } from "./get-org-limits";
import { BillingEntitlementError } from "../errors";

export async function requireOrgEntitlement(
  orgId: string,
  feature: string,
  usage: number
): Promise<void> {
  const limits = await getOrgLimits(orgId);
  const limit = limits[feature];

  // No limit configured for this feature → unlimited, pass.
  if (limit === undefined) {
    return;
  }

  // Strictly greater than: usage equal to the limit passes.
  // The caller passes the prospective total (e.g. currentCount + 1), so
  // usage > limit correctly blocks exceeding the cap.
  if (usage > limit) {
    throw new BillingEntitlementError({ feature, limit, usage });
  }
}
